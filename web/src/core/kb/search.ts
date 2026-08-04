/**
 * SilverCare Voice — 知識庫檢索（T9）
 *
 * Fuse.js 模糊檢索澳門長者知識庫（policy / health / service），
 * 支援粵語口語查詢（如「有冇老人津貼」「長者有咩交通優惠」）。
 *
 * 設計：
 * - ensureKnowledgeLoaded()：若 IndexedDB knowledgeDocuments 表為空，
 *   則以 KNOWLEDGE_BASE bulkPut 導入（冪等；seed 合併邏輯）。
 * - searchKnowledge(query, category?, limit=3)：檢索入口。
 *   絕不逐句 if/else 硬編碼問答 —— 一律走 Fuse 模糊匹配。
 * - 查詢正規化：移除常見粵語虛詞後，對剩餘文本做 2-gram 展開，
 *   合併各候選查詢的最佳分數（中文無空格，長口語句需拆段比對）。
 *
 * T5 intent 接入方式見 ./README.md。
 */

import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import { getProvider } from '../../data/DataProvider';
import { KNOWLEDGE_BASE } from '../../data/knowledgeBase';
import type { KnowledgeDocument, TableName } from '../../types/entities';

const KB_TABLE = 'knowledgeDocuments' as TableName;

/** Fuse 設定：中文長文本用 ignoreLocation；threshold 放寬容納口語／錯字。 */
const FUSE_OPTIONS: IFuseOptions<KnowledgeDocument> = {
  keys: [
    { name: 'title', weight: 3 },
    { name: 'summary', weight: 2 },
    { name: 'eligibility', weight: 1 },
    { name: 'category', weight: 0.4 },
  ],
  threshold: 0.45,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
};

/** 常見粵語虛詞／口語前綴（純通用正規化，非針對個別問題的問答表）。 */
const CANTONESE_STOP_WORDS = [
  '我想知', '想知道', '可唔可以', '請問下', '請問', '有冇得', '點樣',
  '點解', '邊度', '邊個', '幾時', '係咪', '唔該', '有冇', '有咩',
  '有無', '咩嘢', '啲咩', '點算', '先至', '嘅', '喺', '㗎',
  '喇', '呀', '啲',
];

let loadPromise: Promise<void> | null = null;
let docsCache: KnowledgeDocument[] | null = null;
let fuseCache: Fuse<KnowledgeDocument> | null = null;

function buildFuse(docs: KnowledgeDocument[]): Fuse<KnowledgeDocument> {
  return new Fuse(docs, FUSE_OPTIONS);
}

/**
 * 確保知識庫已導入 IndexedDB 並載入記憶體索引（冪等）。
 * 表非空時不重複寫入；載入後建立 Fuse 單例索引。
 */
export async function ensureKnowledgeLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const provider = getProvider();
      let docs = await provider.list<KnowledgeDocument>(KB_TABLE);
      if (docs.length === 0) {
        await provider.bulkPut(
          KNOWLEDGE_BASE.map((doc) => ({ table: KB_TABLE, entity: doc })),
        );
        docs = await provider.list<KnowledgeDocument>(KB_TABLE);
      }
      docsCache = docs;
      fuseCache = buildFuse(docs);
    })().catch((err) => {
      // 失敗時允許下次重試
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

/** 測試專用：清空模組快取（生產代碼不要使用）。 */
export function __resetKbCacheForTest(): void {
  loadPromise = null;
  docsCache = null;
  fuseCache = null;
}

/** 移除常見粵語虛詞，取得檢索主體。 */
function stripStopWords(query: string): string {
  let out = query;
  for (const w of CANTONESE_STOP_WORDS) {
    out = out.split(w).join('');
  }
  return out.replace(/\s+/g, '');
}

/**
 * 產生候選查詢：原句 → 去虛詞 → 2-gram 片段。
 * 中文無空格分詞，長口語句拆成 2 字片段再合併分數，
 * 可大幅提升「長者有咩交通優惠」一類查詢的命中率。
 */
function queryCandidates(query: string): string[] {
  const cleaned = stripStopWords(query);
  const set = new Set<string>();
  if (query.trim().length >= 2) set.add(query.trim());
  if (cleaned.length >= 2) set.add(cleaned);
  if (cleaned.length >= 4) {
    for (let i = 0; i + 2 <= cleaned.length; i += 1) {
      set.add(cleaned.slice(i, i + 2));
    }
  }
  return [...set];
}

/**
 * 知識庫檢索。
 *
 * @param query    粵語口語或書面語查詢；空白查詢回傳空陣列（不拋錯）。
 * @param category 選填：限定 'policy' | 'health' | 'service'。
 * @param limit    回傳筆數上限（預設 3）。
 * @returns 依相關度排序的 KnowledgeDocument[]；無結果回傳空陣列。
 */
export async function searchKnowledge(
  query: string,
  category?: string,
  limit = 3,
): Promise<KnowledgeDocument[]> {
  const q = (query ?? '').trim();
  if (!q || limit <= 0) return [];

  await ensureKnowledgeLoaded();
  if (!fuseCache || !docsCache) return [];

  // 逐候選查詢檢索；同一条目取各候選的最佳分數，
  // 並以「覆蓋率懲罰」偏好命中更多查詢片段的條目
  //（避免單一高頻詞如「長者」令長尾條目打平手）。
  const perDoc = new Map<string, { doc: KnowledgeDocument; scores: number[] }>();
  const candidates = queryCandidates(q).filter((c) => c.length >= 2);
  for (const candidate of candidates) {
    for (const r of fuseCache.search(candidate)) {
      const score = r.score ?? 1;
      const agg = perDoc.get(r.item.id);
      if (agg) {
        agg.scores.push(score);
      } else {
        perDoc.set(r.item.id, { doc: r.item, scores: [score] });
      }
    }
  }

  const total = Math.max(candidates.length, 1);
  let results = [...perDoc.values()]
    .map(({ doc, scores }) => {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const coveragePenalty = (total - scores.length) / total;
      return { doc, score: mean + coveragePenalty };
    })
    .sort((a, b) => a.score - b.score)
    .map((v) => v.doc);
  if (category) {
    results = results.filter((d) => d.category === category);
  }
  return results.slice(0, limit);
}

/** 取目前索引中的全部條目（已確保載入）。 */
export async function listKnowledge(): Promise<KnowledgeDocument[]> {
  await ensureKnowledgeLoaded();
  return docsCache ?? [];
}

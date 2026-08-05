/**
 * 通用文字匹配工具（純函數、無副作用）。
 *
 * 分五級匹配（tier 由強到弱）：
 *   exact      — 原始字串完全相同
 *   normalized — 正規化後相同（大小寫／全形半形／空白差異）
 *   prefix     — 正規化後為前綴匹配
 *   contains   — 正規化後包含查詢
 *   fuzzy      — Fuse.js 模糊匹配（容納錯字／口語變體）
 *
 * 供 SearchableCombobox（藥物／地點選擇）與 medicationSearch 共用。
 */

import Fuse from 'fuse.js';

/** 匹配分級（由強到弱）。 */
export type MatchTier = 'exact' | 'normalized' | 'prefix' | 'contains' | 'fuzzy';

/** 單筆匹配結果：tier 為分級、score 越小越佳（同 tier 內可比較）。 */
export interface RankedMatch<T> {
  tier: MatchTier;
  item: T;
  /** 排序分數，越小越優先；跨 tier 以 tier 優先，score 僅在同 tier 內有意義。 */
  score: number;
}

/** tier 排序權重（越小越優先）。 */
const TIER_ORDER: Record<MatchTier, number> = {
  exact: 0,
  normalized: 1,
  prefix: 2,
  contains: 3,
  fuzzy: 4,
};

/** 各 tier 的分數帶起點，確保跨 tier 排序穩定（score 落在 [base, base+0.1)）。 */
const TIER_SCORE_BASE: Record<MatchTier, number> = {
  exact: 0,
  normalized: 0.1,
  prefix: 0.2,
  contains: 0.3,
  fuzzy: 0.5,
};

/**
 * 正規化字串：trim → 全形轉半形（NFKC）→ lowercase → 去除所有空白。
 * 使「Ａｍｏｘｉｃｉｌｌｉｎ」「amoxicillin」「Amoxicillin 」視為相同。
 *
 * @param s 原始字串（null/undefined 視同空字串）。
 * @returns 正規化後字串。
 */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC') // 全形英數／數字／空格 → 半形
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * 對候選項做分級匹配並排序。
 *
 * 排序規則：先按 tier 優先序（exact > normalized > prefix > contains > fuzzy），
 * 同 tier 內按 score 升冪（fuzzy tier 為 Fuse.js 分數映射，越小越相似）。
 *
 * @param query      用戶輸入；空白（trim 後）回傳空陣列。
 * @param candidates 候選項目列表。
 * @param getText    取候選項可比對文字（如選項 label）。
 * @returns 匹配結果陣列（僅含至少一個 tier 命中的項目）。
 */
export function rankMatches<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string,
): RankedMatch<T>[] {
  const q = (query ?? '').trim();
  if (!q || candidates.length === 0) return [];

  const nq = normalizeText(q);
  const results: RankedMatch<T>[] = [];
  const fuzzyPool: T[] = [];

  for (const item of candidates) {
    const text = getText(item) ?? '';
    const nt = normalizeText(text);
    if (!nt) continue;

    if (text === q) {
      results.push({ tier: 'exact', item, score: TIER_SCORE_BASE.exact });
    } else if (nt === nq) {
      results.push({ tier: 'normalized', item, score: TIER_SCORE_BASE.normalized });
    } else if (nt.startsWith(nq)) {
      // 前綴越短（相對查詢長度）越優先
      const score = TIER_SCORE_BASE.prefix + Math.min(0.09, (nt.length - nq.length) / 1000);
      results.push({ tier: 'prefix', item, score });
    } else if (nt.includes(nq)) {
      // 命中位置越靠前越優先
      const score = TIER_SCORE_BASE.contains + Math.min(0.09, nt.indexOf(nq) / 1000);
      results.push({ tier: 'contains', item, score });
    } else {
      fuzzyPool.push(item);
    }
  }

  // 剩餘候選走 Fuse.js 模糊匹配（錯字／口語變體）
  if (fuzzyPool.length > 0 && nq.length >= 1) {
    const fuse = new Fuse(
      fuzzyPool.map((item) => ({ item, text: getText(item) ?? '' })),
      {
        keys: ['text'],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: true,
      },
    );
    for (const r of fuse.search(nq)) {
      const fuseScore = r.score ?? 1;
      // 映射到 fuzzy 分數帶 [0.5, 0.6)，保持「越小越佳」
      results.push({ tier: 'fuzzy', item: r.item.item, score: TIER_SCORE_BASE.fuzzy + fuseScore * 0.1 });
    }
  }

  return results.sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.score - b.score,
  );
}

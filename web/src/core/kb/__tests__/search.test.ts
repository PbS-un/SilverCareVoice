/**
 * T9 知識庫單測：searchKnowledge（Fuse.js）+ ensureKnowledgeLoaded（冪等導入）
 *
 * 覆蓋：粵語口語／書面語查詢命中正確 category 與條目、
 * category 過濾、空查詢與無結果不拋錯、導入冪等。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetProviderForTest, getProvider } from '../../../data/DataProvider';
import { KNOWLEDGE_BASE, knowledgeByCategory } from '../../../data/knowledgeBase';
import type { KnowledgeDocument } from '../../../types/entities';
import {
  __resetKbCacheForTest,
  ensureKnowledgeLoaded,
  searchKnowledge,
} from '../search';

/** 清空全部表（不帶 seed），驗證 ensureKnowledgeLoaded 的補導路徑。 */
async function clearAll(): Promise<void> {
  __resetProviderForTest();
  __resetKbCacheForTest();
  await getProvider().reset();
}

beforeEach(async () => {
  await clearAll();
});

describe('ensureKnowledgeLoaded — 導入冪等', () => {
  it('表為空時自動導入全部 KNOWLEDGE_BASE 條目', async () => {
    await ensureKnowledgeLoaded();
    const docs = await getProvider().list<KnowledgeDocument>('knowledgeDocuments');
    expect(docs.length).toBe(KNOWLEDGE_BASE.length);
    expect(docs.every((d) => d.id.startsWith('kb-'))).toBe(true);
  });

  it('重複呼叫不會重複寫入（冪等）', async () => {
    await ensureKnowledgeLoaded();
    await ensureKnowledgeLoaded();
    const docs = await getProvider().list<KnowledgeDocument>('knowledgeDocuments');
    expect(docs.length).toBe(KNOWLEDGE_BASE.length);
  });

  it('知識庫分類數量符合規格（policy≥10、health≥10、service≥8）', () => {
    expect(knowledgeByCategory('policy').length).toBeGreaterThanOrEqual(10);
    expect(knowledgeByCategory('health').length).toBeGreaterThanOrEqual(10);
    expect(knowledgeByCategory('service').length).toBeGreaterThanOrEqual(8);
  });
});

describe('searchKnowledge — 粵語／書面語查詢命中', () => {
  it('「有冇老人津貼」→ policy，命中敬老金', async () => {
    const hits = await searchKnowledge('有冇老人津貼');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].category).toBe('policy');
    expect(hits.some((d) => d.id === 'kb-policy-01')).toBe(true);
  });

  it('「長者有咩交通優惠」→ policy，命中巴士車資優惠／乘車碼', async () => {
    const hits = await searchKnowledge('長者有咩交通優惠');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].category).toBe('policy');
    expect(hits.some((d) => d.id === 'kb-policy-05')).toBe(true);
  });

  it('「覆診要準備啲咩」→ health，命中覆診前準備', async () => {
    const hits = await searchKnowledge('覆診要準備啲咩');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-health-10' && d.category === 'health')).toBe(true);
  });

  it('「成日頭暈點算好」→ health，命中頭暈條目', async () => {
    const hits = await searchKnowledge('成日頭暈點算好');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-health-05' && d.category === 'health')).toBe(true);
  });

  it('「頭痛要唔要睇醫生」→ health，命中頭痛條目', async () => {
    const hits = await searchKnowledge('頭痛要唔要睇醫生');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-health-06')).toBe(true);
  });

  it('「附近有咩醫療服務」→ service，命中醫院／衛生中心', async () => {
    const hits = await searchKnowledge('附近有咩醫療服務');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].category).toBe('service');
  });

  it('「平安鐘」→ 命中平安鐘相關條目', async () => {
    const hits = await searchKnowledge('平安鐘');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((d) => d.title.includes('平安鐘'))).toBe(true);
  });

  it('「緊急求助打咩電話」→ service，命中緊急求助電話', async () => {
    const hits = await searchKnowledge('緊急求助打咩電話');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-service-05' && d.category === 'service')).toBe(true);
  });

  it('「量血壓」→ health，命中量血壓正確方法', async () => {
    const hits = await searchKnowledge('點樣先至量血壓量得啱');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-health-02')).toBe(true);
  });

  it('「醫療券」→ policy，命中醫療券計劃', async () => {
    const hits = await searchKnowledge('醫療券點用');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => d.id === 'kb-policy-04')).toBe(true);
  });
});

describe('searchKnowledge — 邊界與過濾', () => {
  it('空查詢回傳空陣列，不拋錯', async () => {
    expect(await searchKnowledge('')).toEqual([]);
    expect(await searchKnowledge('   ')).toEqual([]);
  });

  it('無意義查詢回傳空陣列或僅低相關結果，不拋錯', async () => {
    const hits = await searchKnowledge('zzzqqqxx');
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('category 過濾生效：只回傳指定分類', async () => {
    const hits = await searchKnowledge('津貼', 'policy', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((d) => d.category === 'policy')).toBe(true);
  });

  it('limit 生效', async () => {
    const hits = await searchKnowledge('長者', undefined, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});

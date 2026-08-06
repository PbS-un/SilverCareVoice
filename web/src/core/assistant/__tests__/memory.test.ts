/**
 * T7 AI 對話記憶：last-10、順序、同長者連續性、跨長者隔離。
 */
import 'fake-indexeddb/auto';

import { getProvider } from '../../../data/DataProvider';
import { loadRecentConversations } from '../AssistantService';
import { localHybridEngine } from '../LocalHybridEngine';

const provider = getProvider();

function conv(id: string, elderId: string, role: 'elder' | 'assistant', message: string, seq: number) {
  const t = new Date(Date.now() + seq * 1000).toISOString();
  return { id, elderId, role, message, createdAt: t, updatedAt: t };
}

describe('loadRecentConversations', () => {
  beforeEach(async () => {
    await provider.reset();
  });

  it('只取最近 10 句、順序正確（舊→新）', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      conv(`c-${i}`, 'seed-elder-01', i % 2 === 0 ? 'elder' : 'assistant', `msg-${i}`, i),
    );
    await provider.bulkPut(rows.map((r) => ({ table: 'conversations', entity: r })));
    const recent = await loadRecentConversations('seed-elder-01', 10);
    expect(recent).toHaveLength(10);
    expect(recent.map((r) => r.message)).toEqual(
      ['msg-5', 'msg-6', 'msg-7', 'msg-8', 'msg-9', 'msg-10', 'msg-11', 'msg-12', 'msg-13', 'msg-14'],
    );
  });

  it('排除指定 id（本輪 user 句）且唔跨長者', async () => {
    const rows = [
      conv('a1', 'seed-elder-01', 'elder', '甲-1', 0),
      conv('a2', 'seed-elder-01', 'assistant', '甲-2', 1),
      conv('b1', 'seed-elder-02', 'elder', '乙-1', 0),
      conv('b2', 'seed-elder-02', 'assistant', '乙-2', 1),
    ];
    await provider.bulkPut(rows.map((r) => ({ table: 'conversations', entity: r })));
    const forA = await loadRecentConversations('seed-elder-01', 10, 'a1');
    const forB = await loadRecentConversations('seed-elder-02', 10);
    expect(forA.map((r) => r.message)).toEqual(['甲-2']);
    expect(forB.map((r) => r.message)).toEqual(['乙-1', '乙-2']);
    // 跨長者隔離：甲嘅資料唔會出現喺乙
    expect(forB.some((r) => r.message.includes('甲'))).toBe(false);
  });

  it('冇對話時回空陣列', async () => {
    expect(await loadRecentConversations('seed-elder-99', 10)).toEqual([]);
  });
});

describe('LocalHybridEngine 對話承接（同長者連續性）', () => {
  it('「咁我要唔要休息？」承接上一句血壓話題', () => {
    const res = localHybridEngine.analyze('咁我要唔要休息？', {
      recentMessages: [
        { role: 'assistant', message: '收到，你而家血壓 158/95，我幫你記低咗。' },
      ],
    });
    expect(res.answer).toContain('血壓');
    expect(res.answer).toContain('休息');
  });

  it('冇血壓上文時用普通兜底（唔會亂指血壓）', () => {
    const res = localHybridEngine.analyze('咁我要唔要休息？', { recentMessages: [] });
    expect(res.answer).toContain('記低');
  });
});

/**
 * T1/T4：100 名合成澳門長者 Demo seed 測試。
 *  - 數量：100 elders / 200 accounts(users) / 100 guardians / links
 *  - deterministic：同 seed 兩次生成結果一致
 *  - synthetic flag、account↔elder↔guardian 關係、health-data ownership、隔離
 */
import 'fake-indexeddb/auto';

import { IndexedDBProvider } from '../IndexedDBProvider';
import { buildDemoSeed, seedData } from '../syntheticDemo';
import type { VitalRecord } from '../../types/entities';

const provider = new IndexedDBProvider('silvercare-db-synthetic-test');

describe('synthetic demo seed（100 長者）', () => {
  it('數量正確：100 elders / 200 users / 100 caregivers / 100 links', async () => {
    expect(seedData.elderProfiles).toHaveLength(100);
    expect(seedData.users).toHaveLength(200);
    expect(seedData.caregivers).toHaveLength(100);
    expect(seedData.caregiverLinks).toHaveLength(100);
    expect(seedData.users.filter((u) => u.role === 'elder')).toHaveLength(100);
    expect(seedData.users.filter((u) => u.role === 'caregiver')).toHaveLength(100);
  });

  it('deterministic：同 seed 兩次生成結構一致', () => {
    const again = buildDemoSeed();
    expect(again.elderProfiles.map((e) => e.id)).toEqual(seedData.elderProfiles.map((e) => e.id));
    expect(again.elderProfiles.map((e) => e.name)).toEqual(seedData.elderProfiles.map((e) => e.name));
    expect(again.vitalRecords.map((v) => v.id)).toEqual(seedData.vitalRecords.map((v) => v.id));
  });

  it('全部長者標記 isSynthetic 且有 account code 與固定監護人', () => {
    const caregiverIds = new Set(seedData.caregivers.map((c) => c.id));
    expect(seedData.elderProfiles.every((e) => e.isSynthetic === true)).toBe(true);
    expect(seedData.caregivers.every((c) => c.isSynthetic === true)).toBe(true);

    for (const elder of seedData.elderProfiles) {
      const account = seedData.users.find(
        (u) => u.role === 'elder' && u.refId === elder.id,
      );
      expect(account, `${elder.name} 應有 account`).toBeDefined();
      expect(account!.accountCode).toMatch(/^demo-\d{3}$/);

      const link = seedData.caregiverLinks.find((l) => l.elderId === elder.id);
      expect(link, `${elder.name} 應有一名固定監護人`).toBeDefined();
      expect(caregiverIds.has(link!.caregiverId)).toBe(true);

      const guardian = seedData.caregivers.find((c) => c.id === link!.caregiverId);
      const guardianAccount = seedData.users.find(
        (u) => u.role === 'caregiver' && u.refId === guardian?.id,
      );
      expect(guardianAccount?.accountCode).toBe(account!.accountCode); // 同一 account
    }
  });

  it('health-data ownership：每名長者都有生命徵象，資料歸屬正確', async () => {
    await provider.reset(seedData);
    const elderIds = new Set(seedData.elderProfiles.map((e) => e.id));
    expect(seedData.vitalRecords.length).toBeGreaterThan(400); // 每人 ≥ 數筆
    for (const v of seedData.vitalRecords) {
      expect(elderIds.has(v.elderId)).toBe(true);
    }
    // 抽查兩名長者：查詢只會返回該長者嘅資料
    const e2 = seedData.elderProfiles[1];
    const e3 = seedData.elderProfiles[2];
    const vitals2 = await provider.list<VitalRecord>('vitalRecords', { elderId: e2.id });
    const vitals3 = await provider.list<VitalRecord>('vitalRecords', { elderId: e3.id });
    expect(vitals2.length).toBeGreaterThan(0);
    expect(vitals3.length).toBeGreaterThan(0);
    expect(vitals2.every((v) => v.elderId === e2.id)).toBe(true);
    expect(vitals3.every((v) => v.elderId === e3.id)).toBe(true);
    expect(new Set(vitals2.map((v) => v.elderId))).toEqual(new Set([e2.id]));
  });

  it('conversation 隔離：唔同長者嘅對話唔會混埋', () => {
    const byElder = new Map<string, number>();
    for (const c of seedData.conversations) {
      byElder.set(c.elderId, (byElder.get(c.elderId) ?? 0) + 1);
    }
    expect(byElder.get('seed-elder-01')).toBe(5); // 陳婆婆原 seed 5 句
    for (const [elderId] of byElder) {
      expect(elderId).toMatch(/^seed-elder-\d{2,3}$/);
    }
  });
});

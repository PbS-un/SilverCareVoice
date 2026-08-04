/**
 * T2 資料層單測：IndexedDBProvider（fake-indexeddb）
 * 流程：seed 寫入 → list 查詢 → put 新記錄 → reset 還原。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { IndexedDBProvider } from '../IndexedDBProvider';
import { seedData } from '../seed';
import { KNOWLEDGE_BASE } from '../knowledgeBase';
import type { MedicationLog, VitalRecord } from '../../types/entities';

const ELDER_ID = 'seed-elder-01';

// seed 中 vitalRecords 總數：血壓 6 + 血糖 4 + 心率 3 + 體重 1
const SEED_VITAL_COUNT =
  seedData.vitalRecords.length > 0
    ? seedData.vitalRecords.length
    : (() => { throw new Error('seed 必須含 vitalRecords') })();

// 獨立 DB 名稱，避免與其他測試共享 'silvercare-db'
const provider = new IndexedDBProvider('silvercare-db-test');

function sixDaysAgoISO(offsetHours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  return d.toISOString();
}

beforeEach(async () => {
  await provider.reset(seedData);
});

describe('IndexedDBProvider — seed 寫入與查詢', () => {
  it('reset(seed) 後 list 可查到陳婆婆的血壓序列', async () => {
    const bp = await provider.list<VitalRecord>('vitalRecords', { elderId: ELDER_ID, type: 'blood_pressure' });
    expect(bp).toHaveLength(6);
    expect(bp.map((r) => r.systolic)).toEqual([132, 145, 138, 150, 142, 147]);
  });

  it('vitalsBetween 依 measuredAt 排序並限縮範圍', async () => {
    const from = sixDaysAgoISO();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const all = await provider.vitalsBetween(ELDER_ID, 'blood_pressure', from, to);
    expect(all.length).toBe(6);
    const times = all.map((r) => r.measuredAt);
    expect([...times].sort()).toEqual(times);
    expect(all.every((r) => r.elderId === ELDER_ID && r.type === 'blood_pressure')).toBe(true);
  });

  it('list filter 淺層比對有效', async () => {
    const missed = await provider.list<MedicationLog>('medicationLogs', { status: 'missed' });
    expect(missed).toHaveLength(1);
    expect(missed[0].id).toBe('seed-ml-12');
    const all = await provider.list<MedicationLog>('medicationLogs', { elderId: ELDER_ID });
    expect(all).toHaveLength(18);
  });

  it('seed 各表數量正確', async () => {
    expect(await provider.list('vitalRecords')).toHaveLength(SEED_VITAL_COUNT);
    expect(await provider.list('elderProfiles')).toHaveLength(1);
    expect(await provider.list('caregivers')).toHaveLength(1);
    expect(await provider.list('medications')).toHaveLength(2);
    expect(await provider.list('resourceDirectory')).toHaveLength(6);
    expect(await provider.list('knowledgeDocuments')).toHaveLength(KNOWLEDGE_BASE.length); // T9 已導入知識庫
  });
});

describe('IndexedDBProvider — put / get / remove', () => {
  it('put 新記錄：自動補 createdAt 與 updatedAt', async () => {
    const before = Date.now();
    const rec: VitalRecord = {
      id: crypto.randomUUID(),
      elderId: ELDER_ID,
      type: 'blood_pressure',
      systolic: 151,
      diastolic: 95,
      unit: 'mmHg',
      measuredAt: new Date().toISOString(),
      source: 'voice',
      createdAt: '',
      updatedAt: '',
    };
    const saved = await provider.put('vitalRecords', rec);
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();
    expect(new Date(saved.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const fetched = await provider.get<VitalRecord>('vitalRecords', rec.id);
    expect(fetched?.systolic).toBe(151);
  });

  it('put 更新既有記錄：保留 createdAt、刷新 updatedAt', async () => {
    const original = await provider.get<VitalRecord>('vitalRecords', 'seed-vr-bp-06');
    expect(original).toBeDefined();
    const updated = await provider.put('vitalRecords', { ...original!, diastolic: 92 });
    expect(updated.createdAt).toBe(original!.createdAt);
    expect(updated.diastolic).toBe(92);
  });

  it('remove 刪除單筆', async () => {
    await provider.remove('vitalRecords', 'seed-vr-bp-01');
    expect(await provider.get('vitalRecords', 'seed-vr-bp-01')).toBeUndefined();
  });

  it('subscribe 收到寫入事件', async () => {
    const seen: string[] = [];
    const unsub = provider.subscribe((table) => seen.push(table));
    await provider.put('symptomRecords', {
      id: crypto.randomUUID(),
      elderId: ELDER_ID,
      symptoms: ['疲倦'],
      description: '測試',
      severity: 'mild',
      occurredAt: new Date().toISOString(),
      createdAt: '',
      updatedAt: '',
    });
    unsub();
    expect(seen).toContain('symptomRecords');
  });
});

describe('IndexedDBProvider — reset 還原', () => {
  it('reset 會清除新寫入並還原 seed', async () => {
    const extraId = crypto.randomUUID();
    await provider.put('vitalRecords', {
      id: extraId,
      elderId: ELDER_ID,
      type: 'heart_rate',
      value: 99,
      unit: 'bpm',
      measuredAt: new Date().toISOString(),
      source: 'text',
      createdAt: '',
      updatedAt: '',
    });
    expect(await provider.get('vitalRecords', extraId)).toBeDefined();

    await provider.reset(seedData);

    expect(await provider.get('vitalRecords', extraId)).toBeUndefined();
    expect(await provider.list('vitalRecords')).toHaveLength(SEED_VITAL_COUNT);
    expect(await provider.list('conversations')).toHaveLength(seedData.conversations.length);
  });

  it('reset() 不帶 seed 會清空全部表', async () => {
    await provider.reset();
    expect(await provider.list('vitalRecords')).toHaveLength(0);
    expect(await provider.list('elderProfiles')).toHaveLength(0);
  });
});

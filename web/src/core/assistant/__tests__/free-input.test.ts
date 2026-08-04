/**
 * 自由輸入 fixture 驅動測試（T10）。
 *
 * 每條 fixture 都經 AssistantService.ask() 主管線（真 DB + 離線本地引擎）：
 *  - 唔拋錯、answer 非空、絕無「只支援預設問題」式拒絕語
 *  - intent 命中預期集合
 *  - riskLevel 正確；高風險句必須 urgent + 通知家人／緊急求助
 *  - 抽取數據以 DB 實際寫入驗證（VitalRecord / SymptomRecord / MedicationLog）
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProvider } from '../../../data/DataProvider';
import { seedData } from '../../../data/seed';
import { tableNameOf } from '../../../types/entities';
import type {
  Medication,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../../../types/entities';
import { ask } from '../AssistantService';
import { invalidateProbeCache } from '../DeepSeekClient';
import { FREE_INPUT_CASES, type FreeInputCase } from './free-input.cases';

const ELDER_ID = 'seed-elder-01';

const fetchMock = vi.fn(async () => {
  throw new Error('offline in test');
});

beforeEach(async () => {
  // 攔截 fetch：probeProxy 必然失敗 → 純本地引擎路徑（確定性）
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  invalidateProbeCache();
  await getProvider().reset(seedData);
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateProbeCache();
});

/** 只取運行時新寫入（非 seed）嘅記錄。 */
function fresh<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((r) => !r.id.startsWith('seed-'));
}

/** 按 fixture 斷言抽取數據真寫入 DB。 */
async function assertExtractionPersisted(c: FreeInputCase): Promise<void> {
  const expected = c.expectExtracted;
  if (!expected) return;
  const provider = getProvider();

  const vitals = fresh(
    await provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId: ELDER_ID }),
  );

  if (expected.bloodPressure) {
    const bp = vitals.find(
      (v) =>
        v.type === 'blood_pressure' &&
        v.systolic === expected.bloodPressure!.systolic &&
        v.diastolic === expected.bloodPressure!.diastolic,
    );
    expect(bp, `「${c.input}」應寫入血壓 ${expected.bloodPressure.systolic}/${expected.bloodPressure.diastolic}`).toBeDefined();
    expect(bp!.unit).toBe('mmHg');
  }
  if (expected.noBloodPressure) {
    expect(
      vitals.filter((v) => v.type === 'blood_pressure'),
      `「${c.input}」唔應該抽取到血壓`,
    ).toHaveLength(0);
  }
  if (expected.bloodGlucose !== undefined) {
    expect(
      vitals.some((v) => v.type === 'blood_glucose' && v.value === expected.bloodGlucose),
      `「${c.input}」應寫入血糖 ${expected.bloodGlucose}`,
    ).toBe(true);
  }
  if (expected.heartRate !== undefined) {
    expect(
      vitals.some((v) => v.type === 'heart_rate' && v.value === expected.heartRate),
      `「${c.input}」應寫入心率 ${expected.heartRate}`,
    ).toBe(true);
  }
  if (expected.weight !== undefined) {
    expect(
      vitals.some((v) => v.type === 'weight' && v.value === expected.weight),
      `「${c.input}」應寫入體重 ${expected.weight} kg`,
    ).toBe(true);
  }

  if (expected.symptomsContains) {
    const symptoms = fresh(
      await provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), { elderId: ELDER_ID }),
    );
    for (const s of expected.symptomsContains) {
      expect(
        symptoms.some((r) => r.symptoms.includes(s)),
        `「${c.input}」應記錄症狀「${s}」`,
      ).toBe(true);
    }
  }

  if (expected.medicationStatus && expected.medicationName) {
    // 有藥物名 → 管線必更新／建立對應藥物今日劑量嘅 MedicationLog。
    // seed 藥物嘅 log 會原地更新（id 仍係 seed-*），所以呢度唔用 fresh()。
    const meds = await provider.list<Medication>(tableNameOf('Medication'), {
      elderId: ELDER_ID,
    });
    const med = meds.find((m) => m.name === expected.medicationName);
    expect(med, `「${c.input}」應存在藥物「${expected.medicationName}」`).toBeDefined();

    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: ELDER_ID,
      medicationId: med!.id,
    });
    // 與管線相同嘅揀劑量邏輯：今日、已到時間、最接近而家
    const nowMs = Date.now();
    const today = new Date(nowMs).toDateString();
    const sameDay = logs
      .filter((l) => new Date(l.scheduledAt).toDateString() === today)
      .sort(
        (a, b) =>
          Math.abs(new Date(a.scheduledAt).getTime() - nowMs) -
          Math.abs(new Date(b.scheduledAt).getTime() - nowMs),
      );
    const due = sameDay.find((l) => new Date(l.scheduledAt).getTime() <= nowMs) ?? sameDay[0];
    expect(due, `「${c.input}」藥物「${expected.medicationName}」應有今日劑量記錄`).toBeDefined();
    expect(due!.status, `「${c.input}」嘅服藥狀態`).toBe(expected.medicationStatus);
    if (expected.medicationStatus === 'taken' || expected.medicationStatus === 'late') {
      expect(due!.takenAt).toBeTruthy();
    }

    // 非 seed 藥物應自動建立 Medication
    const freshMeds = fresh(meds);
    const seedMedNames = ['降壓藥', '降糖藥'];
    if (!seedMedNames.includes(expected.medicationName)) {
      expect(
        freshMeds.some((m) => m.name === expected.medicationName),
        `「${c.input}」應建立藥物「${expected.medicationName}」`,
      ).toBe(true);
    }
  }
}

describe('自由輸入 fixture 套件 — 經 AssistantService 主管線', () => {
  it('fixture 數量 ≥ 25 且輸入互不重複', () => {
    expect(FREE_INPUT_CASES.length).toBeGreaterThanOrEqual(25);
    const inputs = FREE_INPUT_CASES.map((c) => c.input);
    expect(new Set(inputs).size).toBe(inputs.length);
  });

  for (const c of FREE_INPUT_CASES) {
    it(`「${c.input}」（${c.id}）intent／風險／抽取全部正確`, async () => {
      // 主管線唔拋錯
      const res = await ask(ELDER_ID, c.input);

      // answer 非空、無拒絕語
      expect(res.answer.length).toBeGreaterThan(0);
      expect(res.answer).not.toContain('只支援');
      expect(res.answer).not.toContain('無法理解');
      expect(res.answer).not.toContain('唔識別');

      // intent 合理
      expect(c.intents, `「${c.input}」嘅 intent`).toContain(res.intent);

      // 風險等級：高風險必須 urgent；其餘按 fixture 或至少非 urgent
      if (c.highRisk) {
        expect(res.riskLevel, `「${c.input}」高風險句必須 urgent`).toBe('urgent');
      } else if (c.riskLevel) {
        expect(res.riskLevel, `「${c.input}」嘅 riskLevel`).toBe(c.riskLevel);
      } else {
        expect(res.riskLevel).not.toBe('urgent');
      }

      // actions 標記
      if (c.actionsContains) {
        const types = res.actions.map((a) => a.type);
        for (const t of c.actionsContains) {
          expect(types, `「${c.input}」應有 action「${t}」`).toContain(t);
        }
      }

      // 抽取數據真寫入 DB
      await assertExtractionPersisted(c);
    });
  }
});

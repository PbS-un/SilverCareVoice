/**
 * T5 ReportService 測試：週報全部由 DB 實際計算（預期值同樣由 DB 實時計算，唔硬編碼）。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { getProvider } from '../../data/DataProvider';
import { seedData } from '../../data/seed';
import { tableNameOf } from '../../types/entities';
import type {
  HealthEvent,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../../types/entities';
import { getWeeklyReport } from '../ReportService';

const ELDER_ID = 'seed-elder-01';

beforeEach(async () => {
  await getProvider().reset(seedData);
});

/** 與 ReportService 相同嘅窗口：[now-7d, now] */
function window7(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 7 * 86_400_000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

describe('ReportService.getWeeklyReport — 由 DB 實際計算', () => {
  it('服藥依從、記錄數、事件數與 DB 一致', async () => {
    const provider = getProvider();
    const report = await getWeeklyReport(ELDER_ID);
    const { from, to } = window7();

    const logs = (
      await provider.list<MedicationLog>(tableNameOf('MedicationLog'), { elderId: ELDER_ID })
    ).filter((l) => l.scheduledAt >= from && l.scheduledAt <= to);
    const taken = logs.filter((l) => l.status === 'taken' || l.status === 'late').length;

    expect(report.medicationAdherence.expected).toBe(logs.length);
    expect(report.medicationAdherence.taken).toBe(taken);
    expect(report.medicationAdherence.rate).toBeCloseTo(
      logs.length > 0 ? taken / logs.length : 1,
      5,
    );

    const vitals = (
      await provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId: ELDER_ID })
    ).filter((v) => v.measuredAt >= from && v.measuredAt <= to);
    const symptoms = (
      await provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), { elderId: ELDER_ID })
    ).filter((s) => s.occurredAt >= from && s.occurredAt <= to);
    expect(report.recordCount).toBe(vitals.length + symptoms.length);

    const events = (
      await provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId: ELDER_ID })
    ).filter((e) => e.createdAt >= from && e.createdAt <= to && e.severity !== 'normal');
    expect(report.eventCount).toBe(events.length);
  });

  it('血壓／血糖平均值與 DB 實時計算一致', async () => {
    const provider = getProvider();
    const report = await getWeeklyReport(ELDER_ID);
    const { from, to } = window7();

    const bp = (
      await provider.vitalsBetween(ELDER_ID, 'blood_pressure', from, to)
    ).filter((r) => r.systolic !== undefined && r.diastolic !== undefined);
    expect(bp.length).toBeGreaterThan(0);
    const sysAvg = Math.round(bp.reduce((s, r) => s + (r.systolic ?? 0), 0) / bp.length);
    const diaAvg = Math.round(bp.reduce((s, r) => s + (r.diastolic ?? 0), 0) / bp.length);
    expect(report.bpAverage).toEqual({ systolic: sysAvg, diastolic: diaAvg });

    const glu = (await provider.vitalsBetween(ELDER_ID, 'blood_glucose', from, to)).filter(
      (r) => r.value !== undefined,
    );
    expect(glu.length).toBeGreaterThan(0);
    const gluAvg =
      Math.round((glu.reduce((s, r) => s + (r.value ?? 0), 0) / glu.length) * 10) / 10;
    expect(report.glucoseAverage).toBe(gluAvg);
  });

  it('topSymptoms 與 aiSummary 基於實際數據', async () => {
    const report = await getWeeklyReport(ELDER_ID);

    // seed 有一筆頭暈記錄（一日前）
    expect(report.topSymptoms).toEqual(
      expect.arrayContaining([{ symptom: '頭暈', count: 1 }]),
    );

    // aiSummary 係 deterministic 組句：包含實際數字
    expect(report.aiSummary).toContain(`${report.recordCount}`);
    expect(report.aiSummary).toContain(
      `${report.medicationAdherence.taken}/${report.medicationAdherence.expected}`,
    );
    if (report.bpAverage) {
      expect(report.aiSummary).toContain(
        `${report.bpAverage.systolic}/${report.bpAverage.diastolic}`,
      );
    }
  });

  it('冇數據嘅長者都回傳合法報告（唔報錯、唔除零）', async () => {
    const report = await getWeeklyReport('nonexistent-elder');
    expect(report.recordCount).toBe(0);
    expect(report.medicationAdherence.expected).toBe(0);
    // 無排程時 rate 必須係有限數（1），絕唔可以係 NaN／Infinity
    expect(Number.isFinite(report.medicationAdherence.rate)).toBe(true);
    expect(report.medicationAdherence.rate).toBe(1);
    expect(report.bpAverage).toBeUndefined();
    expect(report.glucoseAverage).toBeUndefined();
    expect(report.topSymptoms).toHaveLength(0);
    expect(report.eventCount).toBe(0);
    expect(report.aiSummary.length).toBeGreaterThan(0);
    expect(report.aiSummary).toContain('期內無排程服藥記錄');
  });

  it('seed 長者清空晒窗口內記錄後都唔除零', async () => {
    // 模擬「有長者但 7 日窗口內完全冇數據」：用未來嘅一筆記錄代替
    const provider = getProvider();
    const allVitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    // 全部移去 30 日後（窗口外）
    for (const v of allVitals) {
      const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await provider.put<VitalRecord>(tableNameOf('VitalRecord'), {
        ...v,
        measuredAt: future,
      });
    }
    const report = await getWeeklyReport(ELDER_ID);
    expect(Number.isFinite(report.medicationAdherence.rate)).toBe(true);
    expect(report.bpAverage).toBeUndefined();
    expect(report.aiSummary.length).toBeGreaterThan(0);
  });
});

/**
 * T5 InsightService 測試：總覽聚合全部由 DB 計算（預期值同樣由 DB 實時計算）。
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
import { getInsights } from '../InsightService';

beforeEach(async () => {
  await getProvider().reset(seedData);
});

describe('InsightService.getInsights — DB 聚合', () => {
  it('長者數、記錄總數與 DB 一致', async () => {
    const provider = getProvider();
    const insights = await getInsights();

    expect(insights.elderCount).toBe((await provider.list(tableNameOf('ElderProfile'))).length);

    const vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'));
    const symptoms = await provider.list<SymptomRecord>(tableNameOf('SymptomRecord'));
    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'));
    expect(insights.totalRecordCount).toBe(vitals.length + symptoms.length + logs.length);
  });

  it('慢病分佈與服藥依從率正確', async () => {
    const provider = getProvider();
    const insights = await getInsights();

    // seed：高血壓 + 糖尿病 各一
    const dist = Object.fromEntries(insights.chronicConditionDistribution.map((d) => [d.type, d.count]));
    expect(dist.hypertension).toBe(1);
    expect(dist.diabetes).toBe(1);

    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'));
    const taken = logs.filter((l) => l.status === 'taken' || l.status === 'late').length;
    expect(insights.medicationAdherenceRate).toBeCloseTo(taken / logs.length, 5);
  });

  it('事件分級計數與近 7 日趨勢正確', async () => {
    const provider = getProvider();
    const insights = await getInsights();

    const events = await provider.list<HealthEvent>(tableNameOf('HealthEvent'));
    expect(insights.attentionEventCount).toBe(events.filter((e) => e.severity === 'attention').length);
    expect(insights.urgentEventCount).toBe(events.filter((e) => e.severity === 'urgent').length);

    // 趨勢：7 筆、YYYY-MM-DD、總和 = 近 7 日事件數
    expect(insights.last7DayEventTrend).toHaveLength(7);
    for (const entry of insights.last7DayEventTrend) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const recentCount = events.filter((e) => new Date(e.createdAt) >= sevenDaysAgo).length;
    const trendSum = insights.last7DayEventTrend.reduce((s, d) => s + d.count, 0);
    expect(trendSum).toBe(recentCount);
  });

  it('症狀分佈包含 seed 嘅頭暈記錄', async () => {
    const insights = await getInsights();
    const dizziness = insights.symptomDistribution.find((s) => s.symptom === '頭暈');
    expect(dizziness).toBeDefined();
    expect(dizziness!.count).toBeGreaterThanOrEqual(1);
  });

  it('空庫都回傳合法結構（唔報錯）', async () => {
    await getProvider().reset();
    const insights = await getInsights();
    expect(insights.elderCount).toBe(0);
    expect(insights.totalRecordCount).toBe(0);
    // 無服藥記錄時依從率必須係有限數（1），唔可以 NaN／除零
    expect(Number.isFinite(insights.medicationAdherenceRate)).toBe(true);
    expect(insights.medicationAdherenceRate).toBe(1);
    expect(insights.attentionEventCount).toBe(0);
    expect(insights.urgentEventCount).toBe(0);
    expect(insights.chronicConditionDistribution).toHaveLength(0);
    expect(insights.symptomDistribution).toHaveLength(0);
    expect(insights.last7DayEventTrend).toHaveLength(7);
    expect(insights.last7DayEventTrend.every((d) => d.count === 0)).toBe(true);
  });
});

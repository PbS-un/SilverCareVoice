/**
 * InsightService —— 照顧者／管理端總覽聚合（T5）
 *
 * getInsights()：全部由 DB 聚合計算（跨所有長者），冇任何硬編碼數字。
 */
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  ChronicCondition,
  HealthEvent,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../types/entities';

export interface DashboardInsights {
  /** 長者數 */
  elderCount: number;
  /** 健康記錄總數（生命徵象 + 症狀 + 服藥記錄） */
  totalRecordCount: number;
  /** 慢病分佈（按 type 聚合） */
  chronicConditionDistribution: Array<{ type: ChronicCondition['type']; count: number }>;
  /** 整體服藥依從率（taken+late / 全部排程），無記錄時為 1 */
  medicationAdherenceRate: number;
  /** attention 事件數 */
  attentionEventCount: number;
  /** urgent 事件數 */
  urgentEventCount: number;
  /** 症狀分佈（次數由高到低） */
  symptomDistribution: Array<{ symptom: string; count: number }>;
  /** 近 7 日事件趨勢（YYYY-MM-DD → 當日事件數，共 7 筆） */
  last7DayEventTrend: Array<{ date: string; count: number }>;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 跨所有長者聚合總覽數據。 */
export async function getInsights(): Promise<DashboardInsights> {
  const provider = getProvider();

  const [elders, vitals, symptoms, logs, conditions, events] = await Promise.all([
    provider.list(tableNameOf('ElderProfile')),
    provider.list<VitalRecord>(tableNameOf('VitalRecord')),
    provider.list<SymptomRecord>(tableNameOf('SymptomRecord')),
    provider.list<MedicationLog>(tableNameOf('MedicationLog')),
    provider.list<ChronicCondition>(tableNameOf('ChronicCondition')),
    provider.list<HealthEvent>(tableNameOf('HealthEvent')),
  ]);

  // 慢病分佈
  const conditionCounts = new Map<ChronicCondition['type'], number>();
  for (const c of conditions) {
    conditionCounts.set(c.type, (conditionCounts.get(c.type) ?? 0) + 1);
  }
  const chronicConditionDistribution = [...conditionCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // 服藥依從率
  const taken = logs.filter((l) => l.status === 'taken' || l.status === 'late').length;
  const medicationAdherenceRate = logs.length > 0 ? taken / logs.length : 1;

  // 事件分級
  const attentionEventCount = events.filter((e) => e.severity === 'attention').length;
  const urgentEventCount = events.filter((e) => e.severity === 'urgent').length;

  // 症狀分佈
  const symptomCounts = new Map<string, number>();
  for (const r of symptoms) {
    for (const s of r.symptoms) {
      symptomCounts.set(s, (symptomCounts.get(s) ?? 0) + 1);
    }
  }
  const symptomDistribution = [...symptomCounts.entries()]
    .map(([symptom, count]) => ({ symptom, count }))
    .sort((a, b) => b.count - a.count);

  // 近 7 日事件趨勢（以本地日期計）
  const now = new Date();
  const trend: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const key = localDateKey(day);
    const count = events.filter((e) => localDateKey(new Date(e.createdAt)) === key).length;
    trend.push({ date: key, count });
  }

  return {
    elderCount: elders.length,
    totalRecordCount: vitals.length + symptoms.length + logs.length,
    chronicConditionDistribution,
    medicationAdherenceRate,
    attentionEventCount,
    urgentEventCount,
    symptomDistribution,
    last7DayEventTrend: trend,
  };
}

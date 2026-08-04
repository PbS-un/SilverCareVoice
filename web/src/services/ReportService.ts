/**
 * ReportService —— 週報服務（T5）
 *
 * getWeeklyReport(elderId)：全部由 DB 實際計算（過去 7 日），
 * aiSummary 用 deterministic summary generator（按實際數字組句，無 LLM）。
 */
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  HealthEvent,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../types/entities';

export interface WeeklyReport {
  elderId: string;
  /** 統計窗口（日） */
  periodDays: number;
  /** 服藥依從：taken（含 late）/ 應服（窗口內全部排程） */
  medicationAdherence: { taken: number; expected: number; rate: number };
  /** 窗口內健康記錄數（生命徵象 + 症狀） */
  recordCount: number;
  /** 窗口內非 normal 健康事件數 */
  eventCount: number;
  /** 平均血壓（無記錄時 undefined） */
  bpAverage?: { systolic: number; diastolic: number };
  /** 平均血糖 mmol/L（一位小數） */
  glucoseAverage?: number;
  /** 症狀排行（次數由高到低） */
  topSymptoms: Array<{ symptom: string; count: number }>;
  /** deterministic 摘要（按實際數字組句，無 LLM） */
  aiSummary: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 過去 N 日窗口：[now - days, now] */
function windowISO(days: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

function countSymptoms(records: SymptomRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const s of r.symptoms) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  return counts;
}

/** deterministic 摘要生成：按實際數字組句。 */
function buildSummary(report: Omit<WeeklyReport, 'aiSummary'>): string {
  const parts: string[] = [];
  const { taken, expected, rate } = report.medicationAdherence;

  parts.push(`過去七日共記錄 ${report.recordCount} 項健康數據`);

  if (expected > 0) {
    parts.push(`服藥依從率 ${Math.round(rate * 100)}%（${taken}/${expected}）`);
  } else {
    parts.push('期內無排程服藥記錄');
  }

  if (report.bpAverage) {
    parts.push(`平均血壓 ${report.bpAverage.systolic}/${report.bpAverage.diastolic} mmHg`);
  }
  if (report.glucoseAverage !== undefined) {
    parts.push(`平均血糖 ${report.glucoseAverage} mmol/L`);
  }
  if (report.topSymptoms.length > 0) {
    const top = report.topSymptoms[0];
    parts.push(`最常見症狀係${top.symptom}（${top.count} 次）`);
  }
  if (report.eventCount > 0) {
    parts.push(`系統偵測到 ${report.eventCount} 個需要留意嘅健康事件，已通知照顧者跟進`);
  } else {
    parts.push('期內無觸發健康警示');
  }

  return `${parts.join('；')}。`;
}

/** 計算某長者過去 7 日週報（全部由 DB 實際計算）。 */
export async function getWeeklyReport(elderId: string): Promise<WeeklyReport> {
  const provider = getProvider();
  const { from, to } = windowISO(7);

  const [vitals, bpRecordsRaw, glucoseRecordsRaw, symptoms, logs, events] = await Promise.all([
    provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId }),
    provider.vitalsBetween(elderId, 'blood_pressure', from, to),
    provider.vitalsBetween(elderId, 'blood_glucose', from, to),
    provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), { elderId }),
    provider.list<MedicationLog>(tableNameOf('MedicationLog'), { elderId }),
    provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId }),
  ]);

  const vitalsInWindow = vitals.filter((v) => v.measuredAt >= from && v.measuredAt <= to);
  const symptomsInWindow = symptoms.filter((s) => s.occurredAt >= from && s.occurredAt <= to);
  const logsInWindow = logs.filter((l) => l.scheduledAt >= from && l.scheduledAt <= to);
  const eventsInWindow = events.filter(
    (e) => e.createdAt >= from && e.createdAt <= to && e.severity !== 'normal',
  );

  // 服藥依從：taken／late 視為已服
  const takenCount = logsInWindow.filter((l) => l.status === 'taken' || l.status === 'late').length;
  const expected = logsInWindow.length;
  const rate = expected > 0 ? takenCount / expected : 1;

  // 平均血壓（vitalsBetween 已按 measuredAt 排序，求和順序確定）
  const bpRecords = bpRecordsRaw.filter(
    (v) => v.systolic !== undefined && v.diastolic !== undefined,
  );
  const bpAverage =
    bpRecords.length > 0
      ? {
          systolic: Math.round(bpRecords.reduce((s, r) => s + (r.systolic ?? 0), 0) / bpRecords.length),
          diastolic: Math.round(bpRecords.reduce((s, r) => s + (r.diastolic ?? 0), 0) / bpRecords.length),
        }
      : undefined;

  // 平均血糖
  const glucoseRecords = glucoseRecordsRaw.filter((v) => v.value !== undefined);
  const glucoseAverage =
    glucoseRecords.length > 0
      ? round1(glucoseRecords.reduce((s, r) => s + (r.value ?? 0), 0) / glucoseRecords.length)
      : undefined;

  // 症狀排行
  const topSymptoms = [...countSymptoms(symptomsInWindow).entries()]
    .map(([symptom, count]) => ({ symptom, count }))
    .sort((a, b) => b.count - a.count);

  const base: Omit<WeeklyReport, 'aiSummary'> = {
    elderId,
    periodDays: 7,
    medicationAdherence: { taken: takenCount, expected, rate },
    recordCount: vitalsInWindow.length + symptomsInWindow.length,
    eventCount: eventsInWindow.length,
    ...(bpAverage ? { bpAverage } : {}),
    ...(glucoseAverage !== undefined ? { glucoseAverage } : {}),
    topSymptoms,
  };

  return { ...base, aiSummary: buildSummary(base) };
}

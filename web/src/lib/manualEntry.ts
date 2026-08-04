/**
 * T6 手動輸入路徑 —— 快捷鍵／表單寫入與語音／文字路徑同一數據鏈：
 * provider.put → HealthRuleEngine.evaluate → HealthEvent → AlertService。
 *
 * 嚴禁繞過規則引擎；嚴禁 demo-only 分支。
 */
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  Alert,
  ChronicCondition,
  HealthEvent,
  Medication,
  MedicationLog,
  VitalRecord,
  VitalSource,
  VitalType,
} from '../types/entities';
import { evaluate, type RuleInput } from '../core/rules/HealthRuleEngine';
import { createAlertsForEvents } from '../services/AlertService';

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

/** 跑規則引擎：寫 HealthEvent、建 Alert，回傳事件。 */
async function runRules(elderId: string, inputs: RuleInput[]): Promise<HealthEvent[]> {
  const provider = getProvider();
  const freshIds = new Set<string>();
  for (const i of inputs) {
    if (i.kind === 'vital' || i.kind === 'symptom') freshIds.add(i.record.id);
    else freshIds.add(i.log.id);
  }

  const [history, conditions] = await Promise.all([
    provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId }),
    provider.list<ChronicCondition>(tableNameOf('ChronicCondition'), { elderId }),
  ]);

  const events = evaluate(
    inputs,
    history.filter((h) => !freshIds.has(h.id)),
    { chronicConditionTypes: conditions.map((c) => c.type) },
  );

  const saved: HealthEvent[] = [];
  for (const e of events) {
    saved.push(await provider.put<HealthEvent>(tableNameOf('HealthEvent'), e));
  }
  if (saved.length > 0) await createAlertsForEvents(saved);
  return saved;
}

export interface VitalEntryResult {
  record: VitalRecord;
  events: HealthEvent[];
}

/** 寫入一筆血壓（收縮壓／舒張壓）並跑規則引擎。 */
export async function recordBloodPressure(
  elderId: string,
  systolic: number,
  diastolic: number,
  source: VitalSource = 'form',
): Promise<VitalEntryResult> {
  const provider = getProvider();
  const t = isoNow();
  const record: VitalRecord = {
    id: newId(),
    elderId,
    type: 'blood_pressure',
    systolic,
    diastolic,
    unit: 'mmHg',
    measuredAt: t,
    source,
    createdAt: t,
    updatedAt: t,
  };
  const saved = await provider.put<VitalRecord>(tableNameOf('VitalRecord'), record);
  const events = await runRules(elderId, [{ kind: 'vital', record: saved }]);
  return { record: saved, events };
}

/** 寫入一筆單值生命徵象（血糖／心率／體重）並跑規則引擎。 */
export async function recordSingleVital(
  elderId: string,
  type: Exclude<VitalType, 'blood_pressure'>,
  value: number,
  source: VitalSource = 'form',
): Promise<VitalEntryResult> {
  const provider = getProvider();
  const t = isoNow();
  const unit = type === 'blood_glucose' ? 'mmol/L' : type === 'heart_rate' ? 'bpm' : 'kg';
  const record: VitalRecord = {
    id: newId(),
    elderId,
    type,
    value,
    unit,
    measuredAt: t,
    source,
    createdAt: t,
    updatedAt: t,
  };
  const saved = await provider.put<VitalRecord>(tableNameOf('VitalRecord'), record);
  const events = await runRules(elderId, [{ kind: 'vital', record: saved }]);
  return { record: saved, events };
}

export interface MedicationEntryResult {
  log: MedicationLog;
  events: HealthEvent[];
}

/** 記錄食藥狀態（已服／漏服／延遲）：更新或新建 MedicationLog，跑規則引擎。 */
export async function recordMedicationStatus(
  elderId: string,
  medicationId: string,
  status: 'taken' | 'missed' | 'late',
): Promise<MedicationEntryResult> {
  const provider = getProvider();
  const t = isoNow();
  const medication = await provider.get<Medication>(tableNameOf('Medication'), medicationId);
  if (!medication) throw new Error(`recordMedicationStatus: Medication ${medicationId} 唔存在`);

  const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
    elderId,
    medicationId,
  });
  const today = new Date(t).toDateString();
  const nowMs = Date.now();
  const sameDay = logs
    .filter((l) => new Date(l.scheduledAt).toDateString() === today)
    .sort(
      (a, b) =>
        Math.abs(new Date(a.scheduledAt).getTime() - nowMs) -
        Math.abs(new Date(b.scheduledAt).getTime() - nowMs),
    );
  const due = sameDay.find((l) => new Date(l.scheduledAt).getTime() <= nowMs) ?? sameDay[0];

  const log: MedicationLog = due
    ? {
        ...due,
        status,
        ...(status === 'taken' || status === 'late' ? { takenAt: t } : {}),
      }
    : {
        id: newId(),
        elderId,
        medicationId,
        scheduledAt: t,
        status,
        ...(status === 'taken' || status === 'late' ? { takenAt: t } : {}),
        createdAt: t,
        updatedAt: t,
      };
  const saved = await provider.put<MedicationLog>(tableNameOf('MedicationLog'), log);
  const events = await runRules(elderId, [{ kind: 'medication', log: saved, medication }]);
  return { log: saved, events };
}

export interface NotifyFamilyResult {
  event: HealthEvent;
  alerts: Alert[];
}

/** 通知家人：建立 attention 級 HealthEvent 並建 Alert。 */
export async function notifyFamily(elderId: string, summary: string): Promise<NotifyFamilyResult> {
  const provider = getProvider();
  const t = isoNow();
  const event: HealthEvent = {
    id: newId(),
    elderId,
    type: 'family_notify',
    severity: 'attention',
    summary,
    sourceRecordIds: [],
    createdAt: t,
    updatedAt: t,
  };
  const saved = await provider.put<HealthEvent>(tableNameOf('HealthEvent'), event);
  const alerts = await createAlertsForEvents([saved]);
  return { event: saved, alerts };
}

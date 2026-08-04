/**
 * HealthRuleEngine —— 健康規則引擎（T5）
 *
 * ⚠️ Demo triage rules only — 非醫療標準，正式產品須由醫療專業人士審核。
 *
 * 純函數：evaluate(newRecords, history, profile?) → HealthEvent[]
 * 只依賴輸入參數計算，唔讀寫 DB、唔調網絡；寫庫由 AssistantService 負責。
 */
import type {
  HealthEvent,
  Medication,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../../types/entities';

/* ------------------------------ 輸入類型 ------------------------------ */

/** 一次對話新產生嘅記錄（規則引擎嘅評估對象）。 */
export type RuleInput =
  | {
      kind: 'vital';
      record: VitalRecord;
      /** 同一句話入面一齊提到嘅症狀（例：血壓高 + 頭暈） */
      concurrentSymptoms?: string[];
    }
  | { kind: 'symptom'; record: SymptomRecord }
  | { kind: 'medication'; log: MedicationLog; medication?: Medication };

/** 長者背景（慢病類型等），供未來擴充規則用。 */
export interface RuleProfile {
  chronicConditionTypes?: string[];
}

/* ------------------------------ 閾值（Demo 用） ------------------------------ */

const BP_URGENT_SYS = 180;
const BP_URGENT_DIA = 110;
const BP_ATTENTION_SYS = 160;
const BP_ATTENTION_DIA = 100;
const BP_ELEVATED_SYS = 140;
const BP_ELEVATED_DIA = 90;
const TREND_CONSECUTIVE = 3;

const GLUCOSE_URGENT_HIGH = 13.9;
const GLUCOSE_URGENT_LOW = 3.9;
const GLUCOSE_ATTENTION = 11.1;

/**
 * 高風險症狀（與 safetyScreen 攔截詞對應嘅規範症狀名）。
 * 呢啲症狀正常會俾 safetyScreen 先行攔截；規則引擎再兜底一次。
 */
const HIGH_RISK_SYMPTOMS: readonly string[] = [
  '胸痛',
  '胸悶',
  '呼吸困難',
  '氣促',
  '暈倒',
  '昏迷',
  '麻痺',
];

/** 降壓／降糖藥物關鍵詞（漏服要特別提示）。 */
const CRITICAL_MED_KEYWORDS: readonly string[] = ['降壓', '血壓', '降压', '血压', '降糖', '糖尿'];

/* ------------------------------ 工具 ------------------------------ */

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function makeEvent(
  elderId: string,
  type: string,
  severity: 'attention' | 'urgent',
  summary: string,
  sourceRecordIds: string[],
): HealthEvent {
  const t = isoNow();
  return {
    id: newId(),
    elderId,
    type,
    severity,
    summary,
    sourceRecordIds,
    createdAt: t,
    updatedAt: t,
  };
}

function isBpElevated(r: VitalRecord): boolean {
  return (r.systolic ?? 0) >= BP_ELEVATED_SYS || (r.diastolic ?? 0) >= BP_ELEVATED_DIA;
}

/* ------------------------------ 各類規則 ------------------------------ */

function evaluateBp(
  record: VitalRecord,
  concurrentSymptoms: string[],
  history: VitalRecord[],
  events: HealthEvent[],
): void {
  const sys = record.systolic ?? 0;
  const dia = record.diastolic ?? 0;

  // 1) 緊急：SBP≥180 或 DBP≥110
  if (sys >= BP_URGENT_SYS || dia >= BP_URGENT_DIA) {
    events.push(
      makeEvent(
        record.elderId,
        'bp_critical',
        'urgent',
        `血壓 ${sys}/${dia} mmHg 屬緊急偏高，請即刻休息並聯絡家人或尋求醫療協助。`,
        [record.id],
      ),
    );
    return;
  }

  // 2) 需留意：SBP≥160 或 DBP≥100
  if (sys >= BP_ATTENTION_SYS || dia >= BP_ATTENTION_DIA) {
    events.push(
      makeEvent(
        record.elderId,
        'bp_high',
        'attention',
        `血壓 ${sys}/${dia} mmHg 偏高，建議休息後再量度並留意身體狀況。`,
        [record.id],
      ),
    );
    return;
  }

  // 3) 偏高（≥140/90）且伴隨症狀（頭暈等）→ 需留意
  if (isBpElevated(record) && concurrentSymptoms.length > 0) {
    events.push(
      makeEvent(
        record.elderId,
        'bp_high_with_symptom',
        'attention',
        `血壓 ${sys}/${dia} mmHg 偏高，仲伴有${concurrentSymptoms.slice(0, 3).join('、')}，建議休息並留意。`,
        [record.id],
      ),
    );
    return;
  }

  // 4) 趨勢：連同歷史最近連續 3 筆偏高 → trend attention
  const bpHistory = history
    .filter((r) => r.type === 'blood_pressure' && r.systolic !== undefined && r.diastolic !== undefined)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const recent = [...bpHistory, record].slice(-TREND_CONSECUTIVE);
  if (recent.length >= TREND_CONSECUTIVE && recent.every(isBpElevated)) {
    events.push(
      makeEvent(
        record.elderId,
        'bp_trend_high',
        'attention',
        `最近連續 ${TREND_CONSECUTIVE} 次血壓都偏高（最新 ${sys}/${dia} mmHg），建議聯絡照顧者並安排覆診跟進。`,
        recent.map((r) => r.id),
      ),
    );
  }
}

function evaluateGlucose(record: VitalRecord, events: HealthEvent[]): void {
  const value = record.value;
  if (value === undefined) return;

  if (value >= GLUCOSE_URGENT_HIGH) {
    events.push(
      makeEvent(
        record.elderId,
        'glucose_critical_high',
        'urgent',
        `血糖 ${value} mmol/L 嚴重偏高，建議即刻聯絡家人或尋求醫療協助。`,
        [record.id],
      ),
    );
    return;
  }
  if (value <= GLUCOSE_URGENT_LOW) {
    events.push(
      makeEvent(
        record.elderId,
        'glucose_critical_low',
        'urgent',
        `血糖 ${value} mmol/L 過低，建議先食少少嘢補充糖分，唔舒服要即刻搵人幫手。`,
        [record.id],
      ),
    );
    return;
  }
  if (value >= GLUCOSE_ATTENTION) {
    events.push(
      makeEvent(
        record.elderId,
        'glucose_high',
        'attention',
        `血糖 ${value} mmol/L 偏高，建議飲多啲水並留意飲食。`,
        [record.id],
      ),
    );
  }
}

function evaluateSymptom(record: SymptomRecord, events: HealthEvent[]): void {
  const hits = record.symptoms.filter((s) => HIGH_RISK_SYMPTOMS.includes(s));
  if (hits.length === 0) return;
  events.push(
    makeEvent(
      record.elderId,
      'symptom_high_risk',
      'urgent',
      `提到高風險症狀：${hits.join('、')}，請即刻聯絡家人或尋求醫療協助。`,
      [record.id],
    ),
  );
}

function evaluateMedication(
  log: MedicationLog,
  medication: Medication | undefined,
  events: HealthEvent[],
): void {
  if (log.status !== 'missed') return;
  const name = medication?.name ?? '';
  const isCritical = CRITICAL_MED_KEYWORDS.some((k) => name.includes(k));
  if (!isCritical) return;
  events.push(
    makeEvent(
      log.elderId,
      'medication_missed',
      'attention',
      `漏咗食${name || '藥'}（降壓／降糖藥物），建議盡快確認需要唔需要補服，並諮詢醫生意見。`,
      [log.id],
    ),
  );
}

/* ------------------------------ 總入口 ------------------------------ */

/**
 * 評估一批新記錄，回傳觸發咗嘅健康事件。
 *
 * @param newRecords 本次新產生嘅記錄（生命徵象／症狀／服藥）
 * @param history    該長者嘅歷史 VitalRecord（趨勢計算用，按 measuredAt 排序與否皆可）
 * @param profile    長者背景資料（可選）
 */
export function evaluate(
  newRecords: RuleInput[],
  history: VitalRecord[],
  _profile?: RuleProfile,
): HealthEvent[] {
  const events: HealthEvent[] = [];

  // 同一句話入面嘅所有症狀（跨記錄合併，供血壓伴隨症狀規則用）
  const batchSymptoms = new Set<string>();
  for (const input of newRecords) {
    if (input.kind === 'symptom') {
      for (const s of input.record.symptoms) batchSymptoms.add(s);
    } else if (input.kind === 'vital' && input.concurrentSymptoms) {
      for (const s of input.concurrentSymptoms) batchSymptoms.add(s);
    }
  }

  for (const input of newRecords) {
    switch (input.kind) {
      case 'vital': {
        const { record } = input;
        if (record.type === 'blood_pressure') {
          const concurrent = input.concurrentSymptoms ?? [...batchSymptoms];
          evaluateBp(record, concurrent, history, events);
        } else if (record.type === 'blood_glucose') {
          evaluateGlucose(record, events);
        }
        break;
      }
      case 'symptom':
        evaluateSymptom(input.record, events);
        break;
      case 'medication':
        evaluateMedication(input.log, input.medication, events);
        break;
    }
  }

  return events;
}

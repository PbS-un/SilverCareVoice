/**
 * AssistantService —— 核心管線統一入口（T5／T16 執行門控）
 *
 * ask(elderId, text, context?) 流程：
 *  a. 寫 user Conversation
 *  b. safetyScreen 先行（觸發 → urgent 路徑：建 urgent HealthEvent + Alert，
 *     answer 用 safety 模板，絕不調 LLM）
 *  b2. pending 門控（T16）：上一輪有未完成行動（血壓填槽／藥物候選／
 *      新藥確認／覆診確認）時先解析本輪回覆——數字填槽、確認詞執行、
 *      取消詞清除、其他內容當新查詢。上限 MAX_PENDING_TURNS 輪。
 *  c. provider 選擇：probeProxy 可達 → DeepSeekClient；失敗／驗證不過 → LocalHybridEngine
 *  d. 客戶端 zod 再驗證（DeepSeekClient 內已做）
 *  e. 執行門控（T16，provider 無關）：按 extractedData 決定「直接執行／追問／
 *     候選／確認」——血壓齊全先寫；藥物 matchMedications 分級；覆診一律確認；
 *     絕不猜數值、絕不靜默建藥。
 *  f. 查詢類 intent（health_history / appointment_query / family_status_query）
 *     真正查 DB，answer 由實際數據動態生成，絕無固定答案
 *  g. HealthRuleEngine → HealthEvent → AlertService
 *  h. 寫 assistant Conversation + AuditLog
 *  i. 回傳 AssistantResponse（可附 confirmation/candidates/contactCard/openForm/pending）
 *
 * 免責聲明：HEALTH_DISCLAIMER 由此處統一導出，UI 層顯示 answer 時附加，
 * 全產品保持一致（本服務唔會把聲明混入 answer 文字）。
 */
import { getProvider } from '../../data/DataProvider';
import { tableNameOf } from '../../types/entities';
import type {
  Appointment,
  AuditLog,
  Caregiver,
  CaregiverLink,
  ChronicCondition,
  Conversation,
  HealthEvent,
  KnowledgeDocument,
  Medication,
  MedicationLog,
  ServiceQuery,
  SymptomRecord,
  TableName,
  VitalRecord,
  VitalSource,
  VitalType,
} from '../../types/entities';
import type {
  AssistantAction,
  Intent,
  RiskLevel,
  StructuredAnalysis,
} from '../../types/ai';
import type { AppLocale } from '../../i18n';
import { screenHighRiskTerms, type SafetyScreenResult } from './safetyScreen';
import { localizeFallbackAnswer, localizeFallbackDetailed } from './localize';
import {
  localHybridEngine,
  MEDICATION_CANDIDATES_PLACEHOLDER,
  type AssistantContext as LocalContext,
} from './LocalHybridEngine';
import { chatViaProxy, probeProxy } from './DeepSeekClient';
import { evaluate, type RuleInput, type RuleProfile } from '../rules/HealthRuleEngine';
import { searchKnowledge } from '../kb/search';
import { createAlertsForEvents, listOpenAlerts } from '../../services/AlertService';
import { matchMedications } from '../../lib/medicationSearch';
import { formatDose } from '../../lib/doseFormat';
import {
  createMedication,
  notifyFamily,
  recordBloodPressure,
  recordMedicationStatus,
} from '../../lib/manualEntry';
import { extractBloodPressure, extractMedicationDose, resolveRelativeDate } from './extraction';

/** 統一免責聲明（UI 顯示 answer 時附加）。 */
export const HEALTH_DISCLAIMER = '以上為健康資訊，唔係醫療診斷。';

/* ------------------------------ 執行門控類型（T16） ------------------------------ */

/** 服藥狀態。 */
export type MedStatus = 'taken' | 'missed' | 'late';

/** 藥物候選（UI 選擇卡用）。 */
export interface MedCandidate {
  id: string;
  name: string;
  dosage?: string;
}

/** 家人聯絡卡項目。 */
export interface ContactCardItem {
  id: string;
  name: string;
  relation: string;
  phone?: string;
}

/** 覆診確認草稿（YYYY-MM-DD / HH:MM 未組 ISO，確認時先寫庫）。 */
export interface AppointmentDraft {
  date?: string;
  time?: string;
  location?: string;
  department?: string;
  doctor?: string;
  timeTbd?: boolean;
  note?: string;
}

/** 新藥確認草稿。 */
export interface NewMedDraft {
  name: string;
  status: MedStatus;
  doseAmount?: number | string;
  doseUnit?: string;
}

/** 確認卡 payload（覆診／新藥）。 */
export type ConfirmationCard =
  | { kind: 'appointment'; summary: string; payload: AppointmentDraft }
  | { kind: 'new_med'; summary: string; payload: NewMedDraft };

/** 提議打開嘅 Modal 與預填 payload。 */
export interface OpenFormSuggestion {
  form: 'medication' | 'appointment' | 'bloodPressure';
  prefill?: {
    /** medication：藥物搜尋字 */
    query?: string;
    /** appointment 預填欄位 */
    location?: string;
    date?: string;
    time?: string;
    specialty?: string;
    doctor?: string;
    note?: string;
    timeTbd?: boolean;
    /** bloodPressure 預填欄位 */
    systolic?: string;
    diastolic?: string;
  };
}

/**
 * 未完成行動（discriminated union）：隨 AssistantResponse.pending 回傳，
 * UI 下一輪 ask 時經 AssistantContext.pending 帶回。turns 計數，
 * 超過 MAX_PENDING_TURNS 即清除、當普通查詢處理。
 */
export type PendingAction =
  | { kind: 'fill_bp'; partial: { systolic?: number; diastolic?: number }; turns: number }
  | {
      kind: 'med_candidates';
      status: MedStatus;
      candidates: MedCandidate[];
      doseAmount?: number | string;
      doseUnit?: string;
      turns: number;
    }
  | { kind: 'confirm_new_med'; payload: NewMedDraft; turns: number }
  | { kind: 'confirm_appointment'; payload: AppointmentDraft; turns: number };

/** pending 追問／確認輪數上限。 */
export const MAX_PENDING_TURNS = 2;

export interface AssistantContext extends LocalContext {
  /** 目前選定語言（T1.4）：DeepSeek prompt 與本地回覆翻譯使用；缺省 zh-HK。 */
  locale?: AppLocale;
  /** 輸入方式（決定 VitalRecord.source），預設 'text'；語音入口傳 'voice'。 */
  source?: VitalSource;
  /** 內部用：原始輸入文字（症狀記錄 description 用）。 */
  originalText?: string;
  /** 上一輪回傳嘅未完成行動（執行門控用）。 */
  pending?: PendingAction;
}

export interface AssistantResponse {
  /** 1–2 句粵語回覆（未含免責後綴；UI 用 HEALTH_DISCLAIMER 附加） */
  answer: string;
  detailedAnswer?: string;
  intent: Intent;
  riskLevel: RiskLevel;
  actions: AssistantAction[];
  /** 本次寫入咗嘅記錄：表名 → ID 列表 */
  persisted: Partial<Record<TableName, string[]>>;
  provider: 'deepseek' | 'local' | 'safety';
  eventId?: string;
  alertId?: string;
  sources?: string[];
  /** 確認卡（覆診／新藥）：UI 渲染大字「✓ 聽到」卡。 */
  confirmation?: ConfirmationCard;
  /** 藥物候選列表：UI 渲染選擇卡。 */
  candidates?: MedCandidate[];
  /** 家人聯絡卡列表：UI 渲染撥號／通知卡（不撥號不寫入）。 */
  contactCard?: ContactCardItem[];
  /** 提議打開嘅 Modal（預填 payload 隨附）。 */
  openForm?: OpenFormSuggestion;
  /** 未完成行動：下一輪 ask 帶回（無則代表門控已完結）。 */
  pending?: PendingAction;
}

/* ------------------------------ 工具 ------------------------------ */

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function daysAgoISO(days: number, from = Date.now()): string {
  return new Date(from - days * 86_400_000).toISOString();
}

const RISK_RANK: Record<RiskLevel, number> = { normal: 0, attention: 1, urgent: 2 };

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function addPersisted(persisted: Partial<Record<TableName, string[]>>, table: TableName, id: string): void {
  const arr = persisted[table] ?? [];
  arr.push(id);
  persisted[table] = arr;
}

/* ------------------------------ 執行門控工具（T16） ------------------------------ */

/** 確認詞（啱／係／好／要…，可帶語氣助詞；其餘內容一律唔算確認）。 */
function isConfirmWord(text: string): boolean {
  const t = (text ?? '').trim();
  const m = /^(啱|岩|係|系|好|要|嗯|對|对|無錯|沒錯|冇問題|ok|okay)/i.exec(t);
  if (!m) return false;
  const rest = t.slice(m[0].length).replace(/[呀啊喇啦㗎噃嘅吧得嘞。，！？!?,\s]/g, '');
  return rest === '';
}

/** 取消／修改詞（唔啱／唔使／唔好／取消／改…）。 */
function isCancelWord(text: string): boolean {
  const t = (text ?? '').trim();
  const m = /^(唔啱|唔岩|唔係|唔系|唔使|唔好|唔要|唔用|取消|改一改|改吓|改|錯|都唔係|都唔啱)/.exec(t);
  if (!m) return false;
  const rest = t.slice(m[0].length).replace(/[呀啊喇啦㗎嘅先吧。，！？!?,\s]/g, '');
  return rest === '';
}

/** ISO date（YYYY-MM-DD）→ 粵語口語日期（例：8月13日（星期三））。 */
function fmtDateCN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${Number(m[2])}月${Number(m[3])}日（星期${weekday}）`;
}

/** 本地時區日期鍵（YYYY-MM-DD）：timeTbd 預約日期級比較用，避免 UTC 切片時區偏差。 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 合法 ISO 日期鍵（YYYY-MM-DD）判斷：provider 回傳嘅 date 必須過呢關先採用。 */
function isValidISODate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** 具體鐘點（HH:MM）判斷。 */
function isClockTime(v: string | undefined): boolean {
  return Boolean(v && /^\d{1,2}:\d{2}$/.test(v));
}

/** 覆診草稿 → 口語摘要（確認卡／確認回覆共用）。 */
function summarizeAppointment(p: AppointmentDraft): string {
  const parts: string[] = [];
  if (p.date) parts.push(fmtDateCN(p.date));
  parts.push(p.time ? p.time : '時間未定');
  if (p.location) parts.push(`去${p.location}`);
  if (p.department) parts.push(`睇${p.department}`);
  if (p.doctor) parts.push(`搵${p.doctor}醫生`);
  return parts.join('，');
}

/** 覆診草稿 → AppointmentModal 預填 payload。 */
function appointmentPrefill(p: AppointmentDraft): NonNullable<OpenFormSuggestion['prefill']> {
  return {
    ...(p.location ? { location: p.location } : {}),
    ...(p.date ? { date: p.date } : {}),
    ...(p.time ? { time: p.time } : {}),
    ...(p.department ? { specialty: p.department } : {}),
    ...(p.doctor ? { doctor: p.doctor } : {}),
    ...(p.note ? { note: p.note } : {}),
    ...(p.timeTbd ? { timeTbd: true } : {}),
  };
}

/** 合理血壓範圍（與 extraction.ts 同口徑）：收縮壓 60–260、舒張壓 30–160。 */
function normalizeBpPair(first: number, second: number): { systolic: number; diastolic: number } | null {
  let systolic = first;
  let diastolic = second;
  if (systolic < diastolic) [systolic, diastolic] = [diastolic, systolic]; // 講反咗自動調返
  if (systolic < 60 || systolic > 260 || diastolic < 30 || diastolic > 160) return null;
  return { systolic, diastolic };
}

/** 講到血壓但冇完整數值時，先抽取已講明嘅單邊數值（絕不猜另一邊）。 */
function extractPartialBp(text: string): { systolic?: number; diastolic?: number } {
  const partial: { systolic?: number; diastolic?: number } = {};
  const up = /上[壓壓]\D{0,4}?(\d{2,3})/.exec(text);
  const down = /下[壓壓]\D{0,4}?(\d{2,3})/.exec(text);
  if (up) partial.systolic = Number(up[1]);
  if (down) partial.diastolic = Number(down[1]);
  return partial;
}

/** 血壓填槽解析結果。 */
type BpParseResult =
  | { kind: 'complete'; systolic: number; diastolic: number }
  | { kind: 'ask'; question: string; partial: { systolic?: number; diastolic?: number } }
  | { kind: 'none' };

/**
 * 解析填槽回覆：完整配對（關鍵詞／純數字）、單邊標註（上壓／下壓）、
 * 裸數字補槽。絕不猜數值——無法確定時一律追問。
 */
function parseBpReply(text: string, prev: { systolic?: number; diastolic?: number }): BpParseResult {
  // 1) 關鍵詞成對寫法（「血壓138/82」「上壓138下壓82」…）
  const full = extractBloodPressure(text);
  if (full) return { kind: 'complete', ...full };

  // 2) 純數字配對（「138 82」「138/82」）
  const pair = /(\d{2,3})\s*[/、，,\s~至到－-]\s*(\d{2,3})/.exec(text);
  if (pair) {
    const norm = normalizeBpPair(Number(pair[1]), Number(pair[2]));
    if (norm) return { kind: 'complete', ...norm };
    return { kind: 'ask', question: '呢兩個數好似唔太合理喎，可以再講一次上壓同下壓嗎？', partial: {} };
  }

  // 3) 單邊標註
  const partial = { ...prev };
  let labelled = false;
  const up = /上[壓壓]\D{0,4}?(\d{2,3})/.exec(text);
  const down = /下[壓壓]\D{0,4}?(\d{2,3})/.exec(text);
  if (up) {
    partial.systolic = Number(up[1]);
    labelled = true;
  }
  if (down) {
    partial.diastolic = Number(down[1]);
    labelled = true;
  }

  // 4) 裸數字：只有一個數時，補去仲缺嘅槽（兩邊都缺時唔猜）
  if (!labelled) {
    const nums = [...text.matchAll(/\d{2,3}/g)].map((m) => Number(m[0]));
    if (nums.length >= 2) {
      const norm = normalizeBpPair(nums[0], nums[1]);
      if (norm) return { kind: 'complete', ...norm };
      return { kind: 'ask', question: '呢兩個數好似唔太合理喎，可以再講一次上壓同下壓嗎？', partial: {} };
    }
    if (nums.length === 1) {
      if (partial.systolic !== undefined && partial.diastolic === undefined) {
        partial.diastolic = nums[0];
      } else if (partial.diastolic !== undefined && partial.systolic === undefined) {
        partial.systolic = nums[0];
      } else {
        return {
          kind: 'ask',
          question: `收到 ${nums[0]}，呢個係上壓定下壓呀？你話我知兩個數，我即刻幫你記。`,
          partial: prev,
        };
      }
    }
  }

  // 5) 範圍檢查 + 完成判斷
  if (partial.systolic !== undefined && partial.diastolic !== undefined) {
    const norm = normalizeBpPair(partial.systolic, partial.diastolic);
    if (norm) return { kind: 'complete', ...norm };
    return { kind: 'ask', question: '呢兩個數好似唔太合理喎，可以再講一次上壓同下壓嗎？', partial: {} };
  }
  if (partial.systolic !== undefined || partial.diastolic !== undefined) {
    const missing = partial.systolic === undefined ? '上壓' : '下壓';
    const known = partial.systolic ?? partial.diastolic;
    return { kind: 'ask', question: `收到，${partial.systolic !== undefined ? '上' : '下'}壓 ${known}。咁${missing}係幾多呀？`, partial };
  }
  return { kind: 'none' };
}

/** 家人稱謂 → relation 過濾值（配唔到就回 undefined → 列全部）。 */
function relationFromTerms(text: string): string | undefined {
  if (/阿仔|個仔|兒子|儿子/.test(text) || /(?<![仔女])仔(?![女])/.test(text)) return '兒子';
  if (/阿女|個女|女兒|女儿/.test(text)) return '女兒';
  if (/孫/.test(text)) return '孫';
  if (/老公|丈夫/.test(text)) return '丈夫';
  if (/太太|妻子|老伴/.test(text)) return '妻子';
  return undefined;
}

/** 聯絡動詞（冇聯絡動詞嘅家人陳述句唔觸發聯絡卡）。 */
const CONTACT_VERB = /搵|找|打俾|打給|打電話|打電話俾|致電|致电|聯絡|联系|通知|call/i;

/** 提及血壓但冇完整數值（追問用，與 LocalHybridEngine 同口徑）。 */
const BP_MENTION_RE = /血壓|血圧|上壓|下壓|高壓|低壓|收縮壓|舒張壓/;

/** 覆診疑問語氣（與 LocalHybridEngine APPT_QUESTION_PATTERN 同口徑；記錄／追問分岔用）。 */
const APPT_QUESTION_RE = /幾時|幾號|幾點|邊日|要唔要|係咪|可唔可以|有冇|？|\?|吗|嗎/;

/** 服藥動詞 + 藥物線索（引擎補通用：「我食咗一粒拜新同」等非詞典藥名）。 */
const MED_TAKEN_VERB = /(?:食|服|吃)[咗左晒完過]/;
const MED_OBJECT_CUE = /粒|顆|片|包|藥|药|mg|毫克|毫升/;

/**
 * 引擎輸出補充（AssistantService 層）：
 * LocalHybridEngine 藥物詞典只認類別詞（降壓藥等），「我食咗一粒拜新同」
 * 等非詞典藥名會漏抽藥名（甚至歸為 unknown）。呢度喺缺 medicationName 時
 * 用動詞＋劑量線索補抽藥名，令執行門控（候選／新增提議）可以接管。
 * 唔改引擎層代碼。
 */
function supplementMedicationIntent(text: string, analysis: StructuredAnalysis): StructuredAnalysis {
  if (analysis.extractedData?.medicationName) return analysis;
  if (!MED_TAKEN_VERB.test(text) || !MED_OBJECT_CUE.test(text)) return analysis;

  const verbMatch = /(?:食|服|吃)[咗左晒完過]\s*(.*)$/.exec(text);
  if (!verbMatch) return analysis;
  let tail = verbMatch[1];
  const dose = extractMedicationDose(tail);
  tail = tail
    .replace(/\d{1,3}(?:\.\d+)?\s*(?:毫克|毫升|mg|ml|cc|粒|顆|片|包)/gi, '')
    .replace(/[一二兩三四五六七八九十]{1,2}\s*(?:粒|顆|片|包)/g, '')
    .replace(/(?:一粒半|半粒|半顆|半片)/g, '')
    .replace(/半\s*(?:粒|顆|片|毫升|毫克)/g, '')
    .replace(/[，。！？、；：\s]/g, '');
  const name = tail.slice(0, 8).trim();
  if (!name || name.length === 0) return analysis;

  return {
    ...analysis,
    intent: analysis.intent === 'unknown' ? 'medication_taken' : analysis.intent,
    extractedData: {
      ...(analysis.extractedData ?? {}),
      medicationName: name,
      medicationStatus: analysis.extractedData?.medicationStatus ?? 'taken',
      ...(dose ? { medicationDoseAmount: dose.amount, medicationDoseUnit: dose.unit } : {}),
    },
  };
}

/** pending 執行完結時用嘅輕量回覆組裝（唔經 provider 鏈）。 */
function localResolution(
  answer: string,
  intent: Intent,
  extra: Partial<Omit<AssistantResponse, 'persisted' | 'answer' | 'intent'>> = {},
): Omit<AssistantResponse, 'persisted'> {
  return {
    answer,
    intent,
    riskLevel: 'normal',
    actions: [],
    provider: 'local',
    ...extra,
  };
}

/** 門控寫入結果。 */
interface GateOutcome {
  ruleInputs: RuleInput[];
  ruleProfile: RuleProfile;
  /** 門控決定嘅回覆（覆蓋引擎 answer）。 */
  answer?: string;
  pending?: PendingAction;
  confirmation?: ConfirmationCard;
  candidates?: MedCandidate[];
  contactCard?: ContactCardItem[];
  openForm?: OpenFormSuggestion;
  eventId?: string;
  alertId?: string;
}

/**
 * 序數選擇解析（med_candidates 第二輪）：
 * 「第一個／第二種／第3款／1／2」→ 1-based 候選序號；解析唔到 → undefined。
 */
function parseOrdinalChoice(text: string): number | undefined {
  const CN: Record<string, number> = {
    一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const m = /(?:第\s*)?(\d{1,2}|[一二兩两三四五六七八九十])\s*(?:個|種|款)?/.exec((text ?? '').trim());
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : CN[m[1]];
  return n !== undefined && n >= 1 ? n : undefined;
}

/**
 * pending 門控：解析本輪對上一輪未完成行動嘅回覆。
 * 回傳 null = 清除 pending、當新查詢處理（由主管線接手）。
 */
async function resolvePending(
  elderId: string,
  text: string,
  pending: PendingAction,
  context: AssistantContext,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<Omit<AssistantResponse, 'persisted'> | null> {
  const provider = getProvider();
  const source: VitalSource = context.source ?? 'text';

  switch (pending.kind) {
    /* ── 血壓填槽 ── */
    case 'fill_bp': {
      if (isCancelWord(text)) {
        return localResolution('好呀，咁唔記血壓先。之後量完再話我知就得㗎喇。', 'vital_record');
      }
      const parsed = parseBpReply(text, pending.partial);
      if (parsed.kind === 'complete') {
        // 齊全 → recordBloodPressure（規則引擎／警報照 manualEntry 路徑行）
        const { record, events } = await recordBloodPressure(
          elderId,
          parsed.systolic,
          parsed.diastolic,
          source,
        );
        addPersisted(persisted, tableNameOf('VitalRecord'), record.id);
        for (const e of events) addPersisted(persisted, tableNameOf('HealthEvent'), e.id);
        let risk: RiskLevel = 'normal';
        for (const e of events) risk = maxRisk(risk, e.severity);
        let answer = `收到，記低咗你而家血壓 ${parsed.systolic}/${parsed.diastolic}。`;
        if (events.some((e) => e.severity === 'urgent')) {
          answer += '有啲幾高喎，坐低休息先，覺得唔舒服要話家人知呀。';
        } else if (events.length > 0) {
          answer += '有啲數值要留意，休息吓遲啲再量多次啦。';
        }
        return localResolution(answer, 'vital_record', {
          riskLevel: risk,
          ...(events.length > 0 ? { eventId: events[0].id } : {}),
        });
      }
      if (parsed.kind === 'ask') {
        if (pending.turns + 1 >= MAX_PENDING_TURNS) return null; // 超過輪數上限 → 清 pending
        return localResolution(parsed.question, 'vital_record', {
          pending: { kind: 'fill_bp', partial: parsed.partial, turns: pending.turns + 1 },
        });
      }
      return null; // 冇數值內容 → 當新查詢
    }

    /* ── 藥物候選 ── */
    case 'med_candidates': {
      if (isCancelWord(text) || /都唔係|都唔啱|冇食|没吃/.test(text)) {
        return localResolution('好呀，咁唔記食藥先。', 'medication_taken');
      }
      const meds = await provider.list<Medication>(tableNameOf('Medication'), { elderId });
      let med: Medication | undefined;
      // 序數選擇（第一個／第二種／1）→ 直接揀候選；範圍外 fallthrough 當新查詢
      const choice = parseOrdinalChoice(text);
      if (choice !== undefined && choice <= pending.candidates.length) {
        med = meds.find((m) => m.id === pending.candidates[choice - 1].id);
      }
      if (!med) {
        const { candidates, confidence } = matchMedications(text, meds);
        if (confidence === 'high' && candidates.length > 0) {
          med = candidates[0];
        } else {
          // 低置信兜底：用戶講全名（候選名包含於回覆）先算
          const byName = pending.candidates.find(
            (c) => text.includes(c.name) || (text.trim().length >= 2 && c.name.includes(text.trim())),
          );
          if (byName) med = meds.find((m) => m.id === byName.id);
        }
      }
      if (!med) return null; // 再匹配唔到 → 當新查詢

      // recordMedicationStatus 內含規則引擎／警報（manualEntry 路徑）
      const { log, events } = await recordMedicationStatus(elderId, med.id, pending.status);
      addPersisted(persisted, tableNameOf('MedicationLog'), log.id);
      for (const e of events) addPersisted(persisted, tableNameOf('HealthEvent'), e.id);
      let risk: RiskLevel = 'normal';
      for (const e of events) risk = maxRisk(risk, e.severity);
      // 與直寫路徑同一組句（medRecordAnswer），劑量一併覆述，唔丟失
      return localResolution(medRecordAnswer(pending.status, med.name, pending), 'medication_taken', {
        riskLevel: risk,
        ...(events.length > 0 ? { eventId: events[0].id } : {}),
      });
    }

    /* ── 新藥確認 ── */
    case 'confirm_new_med': {
      if (isCancelWord(text)) {
        return localResolution('好呀，咁唔新增呢隻藥先。', 'medication_taken');
      }
      if (!isConfirmWord(text)) return null; // 其他內容 → 當新查詢

      const p = pending.payload;
      const dosage =
        formatDose(p.doseAmount, p.doseUnit) || (p.doseAmount !== undefined ? String(p.doseAmount) : '未填寫');
      const med = await createMedication(provider, elderId, {
        name: p.name,
        dosage,
        ...(typeof p.doseAmount === 'number' ? { doseAmount: p.doseAmount } : {}),
        ...(p.doseUnit ? { doseUnit: p.doseUnit } : {}),
      });
      addPersisted(persisted, tableNameOf('Medication'), med.id);
      const { log, events } = await recordMedicationStatus(elderId, med.id, p.status);
      addPersisted(persisted, tableNameOf('MedicationLog'), log.id);
      for (const e of events) addPersisted(persisted, tableNameOf('HealthEvent'), e.id);
      const verb = p.status === 'taken' ? '食咗' : p.status === 'missed' ? '漏咗食' : '遲咗食';
      let risk: RiskLevel = 'normal';
      for (const e of events) risk = maxRisk(risk, e.severity);
      return localResolution(
        `好嘅，已經幫你新增咗「${med.name}」，仲記低咗你${verb}佢。`,
        'medication_taken',
        { riskLevel: risk, ...(events.length > 0 ? { eventId: events[0].id } : {}) },
      );
    }

    /* ── 覆診確認 ── */
    case 'confirm_appointment': {
      const p = pending.payload;
      if (isCancelWord(text)) {
        // 「唔啱／改」→ 開表單預填修改，唔寫入
        return localResolution('好呀，咁你喺表單度改一改啦。', 'appointment_query', {
          openForm: { form: 'appointment', prefill: appointmentPrefill(p) },
        });
      }

      if (!p.date) {
        // 日期填槽輪（門控追問「幾號去？」之後）：本輪回覆應該係日期。
        if (!isConfirmWord(text)) {
          const filled = resolveRelativeDate(text);
          if (filled) {
            // 填到日期 → 組返完整草稿，回確認卡俾長者核對（唔跳過確認直寫）
            const np: AppointmentDraft = {
              ...p,
              date: filled,
              timeTbd: isClockTime(p.time) ? false : p.timeTbd,
            };
            const summary = summarizeAppointment(np);
            return localResolution(`好嘅，幫你記低覆診：${summary}。啱唔啱呀？`, 'appointment_query', {
              confirmation: { kind: 'appointment', summary, payload: np },
              pending: { kind: 'confirm_appointment', payload: np, turns: pending.turns + 1 },
            });
          }
          // 解析唔到：未超輪數上限 → 再追問一次；超限 → 開表單兜底（絕不靜默失敗）
          if (pending.turns + 1 < MAX_PENDING_TURNS) {
            return localResolution(
              '幾號去呀？你講「下星期三」或者「八月十二號」咁，我幫你記低。',
              'appointment_query',
              { pending: { kind: 'confirm_appointment', payload: p, turns: pending.turns + 1 } },
            );
          }
        }
        // 確認詞但冇日期／追問超限 → 冇日期唔寫庫：開表單補齊
        return localResolution('好呀，不過仲未知道邊一日覆診喎，你喺表單度補返啦。', 'appointment_query', {
          openForm: { form: 'appointment', prefill: appointmentPrefill(p) },
        });
      }

      if (!isConfirmWord(text)) return null; // 其他內容 → 當新查詢

      // date/time 組 ISO（C6 修復）：
      // - 有具體時間（HH:MM）→ 必組 `${date}T${time}:00`，且唔帶 timeTbd——
      //   即使草稿被 provider 輸出誤標 timeTbd，呢度以時間為準修正，
      //   避免「確認卡承諾 15:00，寫庫變 timeTbd／T00:00」。
      // - 只有 date 冇 time → 當日 T00:00 + timeTbd:true。
      // 寫入決策：語音新建一律獨立新紀錄（newId），冇日期＋地點匹配既有
      // Appointment 嘅 upsert／合併邏輯，唔會覆蓋或合併同日同地點既有覆診。
      const hasClock = isClockTime(p.time);
      const t = isoNow();
      const appt: Appointment = {
        id: newId(),
        elderId,
        date: new Date(hasClock ? `${p.date}T${p.time}:00` : `${p.date}T00:00:00`).toISOString(),
        location: p.location ?? '未指定',
        ...(hasClock ? {} : { timeTbd: true }),
        ...(p.department ? { specialty: p.department } : {}),
        ...(p.doctor ? { doctor: p.doctor } : {}),
        ...(p.note ? { note: p.note } : {}),
        createdAt: t,
        updatedAt: t,
      };
      const saved = await provider.put<Appointment>(tableNameOf('Appointment'), appt);
      addPersisted(persisted, tableNameOf('Appointment'), saved.id);
      return localResolution(`好嘅，記低咗你覆診：${summarizeAppointment(p)}。`, 'appointment_query');
    }

    default:
      return null;
  }
}

/**
 * 家人聯絡門控（family_contact intent）：
 * - 有「通知」動詞 → 直接 notifyFamily（現有 Alert 流程）；
 * - 「搵／打俾XX」→ 回聯絡卡（全部 consentGiven 照顧者，稱謂過濾），不撥號不寫入。
 */
async function buildFamilyContactGate(
  elderId: string,
  text: string,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<GateOutcome | null> {
  const provider = getProvider();
  const links = (
    await provider.list<CaregiverLink>(tableNameOf('CaregiverLink'), { elderId })
  ).filter((l) => l.consentGiven);
  const caregivers: Caregiver[] = [];
  for (const l of links) {
    const c = await provider.get<Caregiver>(tableNameOf('Caregiver'), l.caregiverId);
    if (c) caregivers.push(c);
  }
  if (caregivers.length === 0) {
    return {
      ruleInputs: [],
      ruleProfile: {},
      answer: '而家未有家人聯絡資料喺度。你可以話我知家人電話，我幫你記低。',
    };
  }

  // 「通知XX我唔舒服」類（有內容描述）→ 直接通知
  if (/通知|話[俾畀]佢|同佢講/.test(text)) {
    const { event, alerts } = await notifyFamily(elderId, `長者想通知家人：「${text}」`);
    addPersisted(persisted, tableNameOf('HealthEvent'), event.id);
    for (const a of alerts) addPersisted(persisted, tableNameOf('Alert'), a.id);
    const target = caregivers[0].name;
    return {
      ruleInputs: [],
      ruleProfile: {},
      answer: `我已經通知咗你嘅${target}喇，佢會盡快跟進，你唔使擔心。`,
      eventId: event.id,
      alertId: alerts[0]?.id,
    };
  }

  if (!CONTACT_VERB.test(text)) return null; // 純陳述句（「我個女今日會嚟探我」）→ 唔觸發聯絡卡

  // 稱謂過濾；配唔到就列全部
  const wanted = relationFromTerms(text);
  let list = wanted ? caregivers.filter((c) => c.relation === wanted || c.relation.includes(wanted)) : caregivers;
  if (list.length === 0) list = caregivers;

  return {
    ruleInputs: [],
    ruleProfile: {},
    answer: '呢度係你家人嘅聯絡資料，撳個掣就可以打俾佢。',
    contactCard: list.map((c) => ({
      id: c.id,
      name: c.name,
      relation: c.relation,
      ...(c.phone ? { phone: c.phone } : {}),
    })),
  };
}

/** 知識庫搜索（T9）：包一層容錯，任何失敗都降級為 null（提示語），唔阻塞主管線。 */
async function trySearchKnowledge(
  query: string,
  category?: string,
  limit = 3,
): Promise<KnowledgeDocument[] | null> {
  try {
    const res = await searchKnowledge(query, category, limit);
    return Array.isArray(res) ? res : [];
  } catch {
    return null;
  }
}

/* ------------------------------ 安全篩查（含拆字變體補充） ------------------------------ */

/**
 * 補充模式：高風險詞被語氣／副詞拆開時（例：「胸口突然好痛」），
 * 純子字串匹配會漏；呢度用寬鬆模式兜底。只補充、唔覆蓋 safetyScreen，
 * 命中後回傳嘅 matchedTerms 用規範詞，下游模板保持一致。
 */
const SUPPLEMENTARY_RISK_PATTERNS: ReadonlyArray<{ pattern: RegExp; term: string }> = [
  { pattern: /(?:胸口|心口|胸前).{0,4}(?:好|很|勁|突然|隱隱)?痛/, term: '胸口痛' },
  { pattern: /胸.{0,2}悶/, term: '胸悶' },
  { pattern: /(?:透|唞|呼吸|喘).{0,3}唔到.{0,2}氣/, term: '呼吸困難' },
  { pattern: /暈[咗左倒]|暈低/, term: '暈倒' },
];

function fullSafetyScreen(text: string): SafetyScreenResult {
  const base = screenHighRiskTerms(text);
  if (base.triggered) return base;
  const extra = SUPPLEMENTARY_RISK_PATTERNS.filter((r) => r.pattern.test(text)).map(
    (r) => r.term,
  );
  return { triggered: extra.length > 0, matchedTerms: extra };
}

/* ------------------------------ 查詢類：真正查 DB 動態組句 ------------------------------ */

const VITAL_KEYWORDS: Array<{ type: VitalType; pattern: RegExp; label: string }> = [
  { type: 'blood_pressure', pattern: /血壓|上壓|下壓/, label: '血壓' },
  { type: 'blood_glucose', pattern: /血糖/, label: '血糖' },
  { type: 'heart_rate', pattern: /心跳|心率|脈搏/, label: '心跳' },
  { type: 'weight', pattern: /體重/, label: '體重' },
];

function detectVitalTypes(text: string): VitalType[] {
  const found: VitalType[] = [];
  for (const { type, pattern } of VITAL_KEYWORDS) {
    if (pattern.test(text)) found.push(type);
  }
  return found;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function trendWord(records: VitalRecord[]): string {
  if (records.length < 2) return '平穩';
  const mid = Math.floor(records.length / 2);
  const firstHalf = records.slice(0, mid);
  const secondHalf = records.slice(mid);
  const avg = (rs: VitalRecord[]) =>
    rs.reduce((sum, r) => sum + (r.systolic ?? r.value ?? 0), 0) / rs.length;
  const diff = avg(secondHalf) - avg(firstHalf);
  if (diff > 3) return '有上升趨勢';
  if (diff < -3) return '有下降趨勢';
  return '大致平穩';
}

/** health_history／健康數據提問：用 vitalsBetween 計最近 7/30 日均值與趨勢。 */
async function buildHealthHistoryAnswer(
  elderId: string,
  text: string,
): Promise<{ answer: string; detailedAnswer?: string } | null> {
  const provider = getProvider();
  const now = Date.now();
  const from7 = daysAgoISO(7, now);
  const from30 = daysAgoISO(30, now);
  const to = new Date(now).toISOString();

  let types = detectVitalTypes(text);
  if (types.length === 0) types = ['blood_pressure', 'blood_glucose'];

  const parts: string[] = [];
  const details: string[] = [];

  for (const type of types) {
    const label = VITAL_KEYWORDS.find((k) => k.type === type)?.label ?? type;
    const records = await provider.vitalsBetween(elderId, type, from7, to);

    if (records.length === 0) {
      parts.push(`最近七日未有${label}記錄喎`);
      continue;
    }

    if (type === 'blood_pressure') {
      const sysAvg = Math.round(records.reduce((s, r) => s + (r.systolic ?? 0), 0) / records.length);
      const diaAvg = Math.round(records.reduce((s, r) => s + (r.diastolic ?? 0), 0) / records.length);
      parts.push(`最近七日你平均血壓約 ${sysAvg}/${diaAvg} mmHg，${trendWord(records)}`);

      const month = await provider.vitalsBetween(elderId, type, from30, to);
      if (month.length > 0) {
        const mSys = Math.round(month.reduce((s, r) => s + (r.systolic ?? 0), 0) / month.length);
        const mDia = Math.round(month.reduce((s, r) => s + (r.diastolic ?? 0), 0) / month.length);
        details.push(`最近三十日共 ${month.length} 次血壓記錄，平均約 ${mSys}/${mDia} mmHg。`);
      }
    } else {
      const values = records.filter((r) => r.value !== undefined);
      if (values.length === 0) {
        parts.push(`最近七日未有${label}記錄喎`);
        continue;
      }
      const avg = round1(values.reduce((s, r) => s + (r.value ?? 0), 0) / values.length);
      const unit = type === 'weight' ? '公斤' : type === 'heart_rate' ? '下' : ' mmol/L';
      parts.push(
        type === 'heart_rate'
          ? `最近七日你平均心跳每分鐘約 ${avg} ${unit}，${trendWord(values)}`
          : `最近七日你平均${label}約 ${avg}${unit}，${trendWord(values)}`,
      );
    }
  }

  if (parts.length === 0) return null;
  return {
    answer: `${parts.join('；')}。要記得按時量度同記低呀。`,
    ...(details.length > 0 ? { detailedAnswer: details.join('') } : {}),
  };
}

function formatDateHK(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}號 ${hh}:${mm}`;
}

/** 覆診日期口語顯示：timeTbd →「M月D號（時間未定）」，否則沿用 formatDateHK。 */
function fmtAppointmentDateSpoken(a: Appointment): string {
  if (a.timeTbd) {
    const d = new Date(a.date);
    return `${d.getMonth() + 1}月${d.getDate()}號（時間未定）`;
  }
  return formatDateHK(a.date);
}

/** appointment_query：查 Appointment 表，回傳下一個覆診。 */
async function buildAppointmentAnswer(elderId: string): Promise<{ answer: string; detailedAnswer?: string }> {
  const provider = getProvider();
  const now = isoNow();
  const todayKey = localDateKey(new Date());
  const appointments = (await provider.list<Appointment>(tableNameOf('Appointment'), { elderId }))
    // 過濾語義與 FamilyHome.nextAppointment 一致：
    // - timeTbd → 本地日期級比較（當日 T00:00 存儲，完整時間戳比較會令當日 00:00 起消失）；
    // - 有時間 → 保留完整時間戳比較（當日已過嘅舊預約應隱藏）。
    .filter((a) => (a.timeTbd ? localDateKey(new Date(a.date)) >= todayKey : a.date >= now))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (appointments.length === 0) {
    return { answer: '你而家冇未到期嘅覆診預約喎。如果約咗新的，話我知幫你記低呀。' };
  }
  const next = appointments[0];
  const note = next.note ? `${next.note}。` : '';
  return {
    answer: `你下次覆診係${fmtAppointmentDateSpoken(next)}，喺${next.location}。${note}`,
    ...(appointments.length > 1
      ? { detailedAnswer: `之後仲有 ${appointments.length - 1} 個預約。` }
      : {}),
  };
}

/** family_status_query：實查未完成 Alert 與照顧者資料，動態組合理回應（絕無硬編碼答案）。 */
async function buildFamilyStatusAnswer(elderId: string): Promise<{ answer: string }> {
  const provider = getProvider();
  const links = await provider.list<CaregiverLink>(tableNameOf('CaregiverLink'), { elderId });
  if (links.length === 0) {
    return { answer: '而家未有家人聯絡資料喺度。你可以話我知家人電話，我幫你記低。' };
  }
  const caregiver = await provider.get<Caregiver>(tableNameOf('Caregiver'), links[0].caregiverId);
  const name = caregiver?.name ?? '家人';

  // 實查：該長者未完成（open / acknowledged）嘅 Alert
  const openAlerts = await listOpenAlerts(elderId);
  if (openAlerts.length > 0) {
    const hasUrgent = openAlerts.some((a) => a.severity === 'urgent');
    const desc = hasUrgent
      ? '有一項緊急情況，佢哋已經收到通知'
      : '正喺度跟進你嘅健康情況';
    return {
      answer: `你嘅${name}而家跟進緊你嘅情況：${desc}，共有 ${openAlerts.length} 項跟進事項。你唔使太擔心呀。`,
    };
  }
  return { answer: `你嘅${name}而家冇未處理嘅跟進事項，你唔使太擔心。如果想佢，可以叫我幫你聯絡佢呀。` };
}

/* ------------------------------ 主流程 ------------------------------ */

/** 門控直寫藥物記錄後的確定性回覆（T16）：補充抽取升級嘅 intent 原 answer
 * 可能係兜底句，直寫後必須明確講「記低咗」。劑量有就一併覆述。 */
function medRecordAnswer(
  status: MedStatus,
  medName: string,
  doseFields: { doseAmount?: number | string; doseUnit?: string },
): string {
  const verb = status === 'taken' ? '食咗' : status === 'missed' ? '漏咗食' : '遲咗食';
  const dose = formatDose(doseFields.doseAmount, doseFields.doseUnit);
  return `好嘅，記低咗你${verb}「${medName}」${dose ? `（${dose}）` : ''}。`;
}

/**
 * 執行門控主體（T16）：按 extractedData 決定「直接執行／追問／候選／確認」。
 * 能安全直寫嘅照寫（ruleInputs 交主管線跑規則引擎）；唔確定嘅一律唔寫，
 * 回傳 gate（pending/confirmation/candidates/contactCard/openForm）俾 UI。
 */
async function applyExecutionGate(
  elderId: string,
  analysis: StructuredAnalysis,
  context: AssistantContext,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<GateOutcome> {
  const provider = getProvider();
  const ed = analysis.extractedData ?? {};
  const text = context.originalText ?? '';
  const ruleInputs: RuleInput[] = [];
  const gate: GateOutcome = { ruleInputs, ruleProfile: {} };
  const t = isoNow();
  const source: VitalSource = context.source ?? 'text';

  const putVital = async (partial: Omit<VitalRecord, 'id' | 'elderId' | 'createdAt' | 'updatedAt' | 'measuredAt' | 'source'>) => {
    const record: VitalRecord = {
      id: newId(),
      elderId,
      measuredAt: t,
      source,
      createdAt: t,
      updatedAt: t,
      ...partial,
    };
    const saved = await provider.put<VitalRecord>(tableNameOf('VitalRecord'), record);
    addPersisted(persisted, tableNameOf('VitalRecord'), saved.id);
    return saved;
  };

  // ── 血壓門控：收縮壓＋舒張壓齊全先寫；唔齊全追問，絕不猜數值 ──
  if (ed.bloodPressure && ed.bloodPressure.systolic !== undefined && ed.bloodPressure.diastolic !== undefined) {
    const saved = await putVital({
      type: 'blood_pressure',
      systolic: ed.bloodPressure.systolic,
      diastolic: ed.bloodPressure.diastolic,
      unit: 'mmHg',
    });
    ruleInputs.push({ kind: 'vital', record: saved, concurrentSymptoms: ed.symptoms ?? [] });
  } else if (
    !ed.bloodGlucose &&
    ed.heartRate === undefined &&
    ed.weight === undefined &&
    !(ed.symptoms && ed.symptoms.length > 0) &&
    !APPT_QUESTION_RE.test(text) &&
    analysis.intent !== 'health_history' &&
    analysis.intent !== 'general_health_question' &&
    analysis.intent !== 'appointment_query' &&
    BP_MENTION_RE.test(text)
  ) {
    // 只有一個數或全缺 → 唔寫入，設 fill_bp pending 追問
    gate.pending = { kind: 'fill_bp', partial: extractPartialBp(text), turns: 0 };
    const partial = (gate.pending as Extract<PendingAction, { kind: 'fill_bp' }>).partial;
    gate.answer =
      partial.systolic !== undefined
        ? `收到，上壓 ${partial.systolic}。咁下壓係幾多呀？`
        : partial.diastolic !== undefined
          ? `收到，下壓 ${partial.diastolic}。咁上壓係幾多呀？`
          : '好呀，你上壓同下壓係幾多？你話我知兩個數，我即刻幫你記。';
  }
  if (ed.bloodGlucose !== undefined) {
    const saved = await putVital({ type: 'blood_glucose', value: ed.bloodGlucose, unit: 'mmol/L' });
    ruleInputs.push({ kind: 'vital', record: saved });
  }
  if (ed.heartRate !== undefined) {
    const saved = await putVital({ type: 'heart_rate', value: ed.heartRate, unit: 'bpm' });
    ruleInputs.push({ kind: 'vital', record: saved });
  }
  if (ed.weight !== undefined) {
    const saved = await putVital({ type: 'weight', value: ed.weight, unit: 'kg' });
    ruleInputs.push({ kind: 'vital', record: saved });
  }

  // 症狀 → SymptomRecord
  if (ed.symptoms && ed.symptoms.length > 0) {
    const severity: SymptomRecord['severity'] =
      analysis.riskLevel === 'urgent' ? 'severe' : analysis.riskLevel === 'attention' ? 'moderate' : 'mild';
    const record: SymptomRecord = {
      id: newId(),
      elderId,
      symptoms: ed.symptoms,
      description: context.originalText ?? '',
      severity,
      occurredAt: t,
      createdAt: t,
      updatedAt: t,
    };
    const saved = await provider.put<SymptomRecord>(tableNameOf('SymptomRecord'), record);
    addPersisted(persisted, tableNameOf('SymptomRecord'), saved.id);
    ruleInputs.push({ kind: 'symptom', record: saved });
  }

  // ── 藥物門控：matchMedications 分級（取代舊 naive includes）──
  // 劑量處理說明：MedicationLog 實體冇備註欄位，為最小侵入，劑量只喺
  // 確認／候選問句覆述，並隨 NewMedDraft 喺用戶確認新增時寫入 Medication；
  // 唔會靜默改寫既有 Medication.dosage。
  if (ed.medicationStatus) {
    const status = ed.medicationStatus;
    const meds = await provider.list<Medication>(tableNameOf('Medication'), { elderId });
    const candidateOf = (m: Medication): MedCandidate => ({
      id: m.id,
      name: m.name,
      ...(m.dosage ? { dosage: m.dosage } : {}),
    });
    const doseFields = {
      ...(ed.medicationDoseAmount !== undefined ? { doseAmount: ed.medicationDoseAmount } : {}),
      ...(ed.medicationDoseUnit ? { doseUnit: ed.medicationDoseUnit } : {}),
    };

    if (ed.medicationName) {
      const { candidates, confidence } = matchMedications(ed.medicationName, meds);
      if (confidence === 'high' && candidates.length > 0) {
        // high = 明確領先（見 medicationSearch.ts 定義）→ 直接記錄
        const savedLog = await writeMedicationLog(provider, elderId, candidates[0], status, t, persisted);
        ruleInputs.push({ kind: 'medication', log: savedLog, medication: candidates[0] });
        // 補充抽取（supplementMedicationIntent）升級嘅 intent 原 answer 係兜底句，
        // 直寫後必須明確回覆「記低咗」，絕不能讓兜底句覆蓋執行結果。
        gate.answer = medRecordAnswer(status, candidates[0].name, doseFields);
      } else if (candidates.length > 0) {
        // 低置信／多候選 → 唔寫入，回候選俾用戶揀
        const top = candidates.slice(0, 4);
        gate.candidates = top.map(candidateOf);
        gate.pending = { kind: 'med_candidates', status, candidates: gate.candidates, ...doseFields, turns: 0 };
        gate.answer =
          top.length === 1
            ? `你係咪講緊「${top[0].name}」呀？`
            : `你講嘅係邊一種藥呀？係咪${top.map((c) => `「${c.name}」`).join('、')}？`;
      } else {
        // 完全冇匹配 → 唔自動建藥；提議新增（表單預填），等用戶確認
        gate.pending = {
          kind: 'confirm_new_med',
          payload: { name: ed.medicationName, status, ...doseFields },
          turns: 0,
        };
        gate.answer = `搵唔到「${ed.medicationName}」喺你嘅藥物名單入面喎，要唔要幫你新增呢隻藥？`;
        gate.openForm = { form: 'medication', prefill: { query: ed.medicationName } };
      }
    } else if (meds.length === 1) {
      // 冇講藥名但只有一隻藥 → 直接記錄（沿用既有行為）
      const savedLog = await writeMedicationLog(provider, elderId, meds[0], status, t, persisted);
      ruleInputs.push({ kind: 'medication', log: savedLog, medication: meds[0] });
      gate.answer = medRecordAnswer(status, meds[0].name, doseFields);
    } else if (meds.length > 1) {
      // 冇講藥名而有多候選 → 問邊一種（替換引擎佔位符）
      const top = meds.slice(0, 4);
      gate.candidates = top.map(candidateOf);
      gate.pending = { kind: 'med_candidates', status, candidates: gate.candidates, ...doseFields, turns: 0 };
      const names = top.map((m) => `「${m.name}」`).join('、');
      gate.answer = analysis.answer.includes(MEDICATION_CANDIDATES_PLACEHOLDER)
        ? analysis.answer.replace(MEDICATION_CANDIDATES_PLACEHOLDER, `係咪${names}？`)
        : `你食嘅係邊一種藥呀？係咪${names}？`;
    } else {
      gate.answer = '你而家未有藥物記錄喎。你可以用「記錄食藥」加咗藥先，再話我知你食咗啦。';
      gate.openForm = { form: 'medication' };
    }
  }

  // ── 覆診門控：有 date／location 一律唔直寫，回確認卡 ──
  if (ed.appointment && (ed.appointment.date || ed.appointment.location)) {
    const a = ed.appointment;
    const hasClock = isClockTime(a.time);
    // 日期兜底解析（回歸修復）：DeepSeek 經常唔回 date（或回非 ISO 嘅相對詞）——
    // 只信 ISO 格式嘅 a.date，否則一律用本地 resolveRelativeDate 對原始文本
    // 補解析「下星期三／聽日／8月12號」等。確認卡與寫庫都必須帶明確日期，
    // 長者先核對到；舊版曾經有呢個兜底，C6 重寫時移除咗導致「啱」後唔寫庫。
    const date = isValidISODate(a.date) ? a.date : resolveRelativeDate(text);
    if (!date) {
      // 有 location／time 但日期真係解析唔到 → 追問「幾號去？」並設填槽
      // pending（絕不靜默失敗；下一輪日期回覆由 resolvePending 接管）。
      const partialDraft: AppointmentDraft = {
        ...(hasClock ? { time: a.time } : {}),
        ...(a.location ? { location: a.location } : {}),
        ...(a.department ? { department: a.department } : {}),
        ...(a.doctor ? { doctor: a.doctor } : {}),
        timeTbd: hasClock ? false : (a.timeTbd ?? true),
        ...(a.note ? { note: a.note } : {}),
      };
      gate.pending = { kind: 'confirm_appointment', payload: partialDraft, turns: 0 };
      gate.answer = `好呀，${a.location ? `去${a.location}` : '覆診'}係幾號呀？你話我知，我幫你記低。`;
    } else {
      const draft: AppointmentDraft = {
        date,
        ...(hasClock ? { time: a.time } : {}),
        ...(a.location ? { location: a.location } : {}),
        ...(a.department ? { department: a.department } : {}),
        ...(a.doctor ? { doctor: a.doctor } : {}),
        // 無具體時間（缺時間／時段詞）→ timeTbd（寫庫時當日 T00:00）。
        // C6：有具體鐘點時 timeTbd 必為 false——provider（DeepSeek）可能同時
        // 回傳 time:'15:00' 與 timeTbd:true，若照單全收會令確認卡承諾 15:00
        // 但寫庫變「時間未定」；呢度以鐘點為準。
        timeTbd: hasClock ? false : (a.timeTbd ?? true),
        // 時段詞（朝早等）入 note 保留
        note: [!hasClock && a.time ? a.time : undefined, a.note].filter(Boolean).join('、') || undefined,
      };
      // 確認卡摘要必帶日期（summarizeAppointment 會將 date 讀成「8月12日（星期三）」）
      const summary = summarizeAppointment(draft);
      gate.confirmation = { kind: 'appointment', summary, payload: draft };
      gate.pending = { kind: 'confirm_appointment', payload: draft, turns: 0 };
      gate.answer = `好嘅，幫你記低覆診：${summary}。啱唔啱呀？`;
    }
  } else if (
    analysis.intent === 'appointment_query' &&
    /覆[診诊]/.test(text) &&
    !APPT_QUESTION_RE.test(text) &&
    !ed.appointment?.date &&
    !ed.appointment?.location
  ) {
    // date 同 location 都缺 → 追問最少必要資料
    gate.answer = '好呀，幾時去？去邊間醫院呀？你話我知，我幫你記低。';
  }

  // 慢病背景（規則引擎 profile 用）
  gate.ruleProfile = await loadRuleProfile(elderId);
  return gate;
}

/** 讀慢病列表組規則引擎 profile。 */
async function loadRuleProfile(elderId: string): Promise<RuleProfile> {
  const conditions = await getProvider().list<ChronicCondition>(tableNameOf('ChronicCondition'), {
    elderId,
  });
  return { chronicConditionTypes: conditions.map((c) => c.type) };
}

/**
 * 寫入服藥記錄（高置信直寫路徑）：優先更新今日最近一筆 log，冇就新建。
 * 規則引擎輸入由主管線統一 evaluate（與既有路徑一致）。
 */
async function writeMedicationLog(
  provider: ReturnType<typeof getProvider>,
  elderId: string,
  med: Medication,
  status: MedStatus,
  t: string,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<MedicationLog> {
  const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
    elderId,
    medicationId: med.id,
  });
  const today = new Date(t).toDateString();
  const nowMs = Date.now();
  // 優先：今日、已到服藥時間、最接近而家嘅一筆
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
        medicationId: med.id,
        scheduledAt: t,
        status,
        ...(status === 'taken' || status === 'late' ? { takenAt: t } : {}),
        createdAt: t,
        updatedAt: t,
      };
  const savedLog = await provider.put<MedicationLog>(tableNameOf('MedicationLog'), log);
  addPersisted(persisted, tableNameOf('MedicationLog'), savedLog.id);
  return savedLog;
}


/** policy / 醫療資源查詢：寫 ServiceQuery + 知識庫搜索，結果附到 sources/answer。 */
async function handleKnowledgeQuery(
  elderId: string,
  text: string,
  intent: Intent,
  queryTopic: string | undefined,
  analysis: StructuredAnalysis,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<{ answer: string; detailedAnswer?: string; sources?: string[] }> {
  const provider = getProvider();
  const t = isoNow();
  const category =
    intent === 'policy_query' ? '政策資訊' : intent === 'medical_resource_query' ? '醫療資源' : '健康資訊';
  // kb 文檔分類（見 core/kb/search.ts）：policy / health / service
  const kbCategory =
    intent === 'policy_query' ? 'policy' : intent === 'medical_resource_query' ? 'service' : 'health';

  const results = await trySearchKnowledge(queryTopic ?? text, kbCategory, 3);

  if (intent === 'policy_query' || intent === 'medical_resource_query') {
    const sq: ServiceQuery = {
      id: newId(),
      elderId,
      query: text,
      category,
      matchedIds: (results ?? [])
        .map((r) => r.id ?? r.title ?? '')
        .filter((id) => id !== ''),
      createdAt: t,
      updatedAt: t,
    };
    const saved = await provider.put<ServiceQuery>(tableNameOf('ServiceQuery'), sq);
    addPersisted(persisted, tableNameOf('ServiceQuery'), saved.id);
  }

  if (results && results.length > 0) {
    const sources = results.map((r) => r.title ?? r.summary ?? '知識庫資料');
    const top = results[0];
    const detail = top.summary ? `${top.title ?? '相關資訊'}：${top.summary}` : '';
    return {
      answer: analysis.answer,
      detailedAnswer: [analysis.detailedAnswer, detail].filter(Boolean).join('\n') || undefined,
      sources,
    };
  }

  // 知識庫未就緒 → 降級提示語
  return {
    answer: analysis.answer,
    detailedAnswer:
      (analysis.detailedAnswer ? `${analysis.detailedAnswer}\n` : '') +
      '詳細資料整理緊，你可以打就近衛生中心或者社工查詢，佢哋會幫到你。',
    sources: undefined,
  };
}

/**
 * 統一入口：分析一句自由輸入，完成抽取寫庫、規則評估、提醒建立，
 * 並回傳長者友善回覆。
 */
export async function ask(
  elderId: string,
  text: string,
  context: AssistantContext = {},
): Promise<AssistantResponse> {
  const provider = getProvider();
  const t = isoNow();
  const locale: AppLocale = context.locale ?? 'zh-HK';
  const normalized = (text ?? '').trim();
  const persisted: Partial<Record<TableName, string[]>> = {};
  const ctx: AssistantContext = { ...context, originalText: normalized };

  // a. 寫 user Conversation（intent 稍後補上）
  const userConv: Conversation = {
    id: newId(),
    elderId,
    role: 'elder',
    message: normalized,
    createdAt: t,
    updatedAt: t,
  };
  const savedUserConv = await provider.put<Conversation>(tableNameOf('Conversation'), userConv);
  addPersisted(persisted, tableNameOf('Conversation'), savedUserConv.id);

  /** 收尾：寫 assistant Conversation + AuditLog，補 user conv intent。 */
  const finish = async (
    res: Omit<AssistantResponse, 'persisted'>,
  ): Promise<AssistantResponse> => {
    // T1.4：最終 user-facing answer 按選定語言輸出（best-effort，缺模板保留原句）
    const answer = localizeFallbackAnswer(res.answer, locale);
    const detailedAnswer = res.detailedAnswer
      ? localizeFallbackDetailed(res.detailedAnswer, locale)
      : undefined;
    const assistantConv: Conversation = {
      id: newId(),
      elderId,
      role: 'assistant',
      message: answer,
      intent: res.intent,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    const savedAssistantConv = await provider.put<Conversation>(
      tableNameOf('Conversation'),
      assistantConv,
    );
    addPersisted(persisted, tableNameOf('Conversation'), savedAssistantConv.id);

    await provider.put<Conversation>(tableNameOf('Conversation'), {
      ...savedUserConv,
      intent: res.intent,
    });

    const audit: AuditLog = {
      id: newId(),
      actor: elderId,
      action: 'assistant.ask',
      entityType: 'Conversation',
      entityId: savedAssistantConv.id,
      detail: `provider=${res.provider}; intent=${res.intent}; risk=${res.riskLevel}`,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    await provider.put<AuditLog>(tableNameOf('AuditLog'), audit);
    addPersisted(persisted, tableNameOf('AuditLog'), audit.id);

    return { ...res, answer, ...(detailedAnswer ? { detailedAnswer } : {}), persisted };
  };

  // b. safety 先行：高風險詞 → urgent 路徑，唔調任何 LLM
  const safety = fullSafetyScreen(normalized);
  if (safety.triggered) {
    const term = safety.matchedTerms[0];
    const event: HealthEvent = {
      id: newId(),
      elderId,
      type: 'safety_screen',
      severity: 'urgent',
      summary: `提及高風險症狀：${safety.matchedTerms.join('、')}。`,
      sourceRecordIds: [],
      createdAt: t,
      updatedAt: t,
    };
    const savedEvent = await provider.put<HealthEvent>(tableNameOf('HealthEvent'), event);
    addPersisted(persisted, tableNameOf('HealthEvent'), savedEvent.id);
    const alerts = await createAlertsForEvents([savedEvent]);
    for (const a of alerts) addPersisted(persisted, tableNameOf('Alert'), a.id);

    return finish({
      answer: `${term}係緊急情況，請即刻坐低休息，馬上聯絡家人或者照顧者幫手。`,
      detailedAnswer:
        '如果情況持續或者加重，請即刻致電緊急求助電話（澳門 999），保持冷靜等待救援。',
      intent: 'emergency',
      riskLevel: 'urgent',
      actions: [
        { type: 'notify_family', label: '通知家人' },
        { type: 'emergency_call', label: '緊急求助' },
      ],
      provider: 'safety',
      eventId: savedEvent.id,
      alertId: alerts[0]?.id,
    });
  }

  // b2. pending 門控（T16）：上一輪未完成行動先解析本輪回覆
  let pendingResolution: Omit<AssistantResponse, 'persisted'> | null = null;
  if (ctx.pending) {
    if (ctx.pending.turns >= MAX_PENDING_TURNS) {
      // 超過輪數上限 → 清除 pending，當普通查詢
      ctx.pending = undefined;
    } else if (ctx.pending.kind === 'fill_bp' || ctx.pending.kind === 'med_candidates') {
      // 血壓填槽：純數字／數值句直接填槽；藥物候選：藥名回答再匹配
      // （兩者都唔需確認詞；解析唔到 → 清 pending 當新查詢）
      pendingResolution = await resolvePending(elderId, normalized, ctx.pending, ctx, persisted);
      if (!pendingResolution) ctx.pending = undefined;
    } else if (ctx.pending.kind === 'confirm_appointment' && !ctx.pending.payload.date) {
      // 覆診日期填槽輪：等緊日期回答（「下星期三」／「八月十二號」…），
      // 唔係確認詞都要交 resolvePending 解析（解析唔到會再追問／開表單）
      pendingResolution = await resolvePending(elderId, normalized, ctx.pending, ctx, persisted);
      if (!pendingResolution) ctx.pending = undefined;
    } else if (isConfirmWord(normalized) || isCancelWord(normalized)) {
      // 確認詞執行／取消詞清除
      pendingResolution = await resolvePending(elderId, normalized, ctx.pending, ctx, persisted);
      if (!pendingResolution) ctx.pending = undefined;
    } else {
      // 其他內容 → 清 pending 當新查詢
      ctx.pending = undefined;
    }
  }

  // pending 已解析（填槽執行／確認詞執行／取消）→ 直接收尾。
  // 必須喺 provider 調用之前 return，避免浪費一次 DeepSeek probe/chat 往返。
  if (pendingResolution) {
    return finish(pendingResolution);
  }

  // c. provider 選擇：proxy 可達 → DeepSeek；否則／失敗 → 本地引擎
  let analysis: StructuredAnalysis;
  let providerField: AssistantResponse['provider'];
  const reachable = await probeProxy();
  if (reachable) {
    const proxyResult = await chatViaProxy(normalized, { userName: ctx.userName, locale });
    if (proxyResult.analysis && (proxyResult.provider === 'deepseek' || proxyResult.provider === 'safety')) {
      analysis = proxyResult.analysis;
      providerField = proxyResult.provider;
    } else {
      analysis = localHybridEngine.analyze(normalized, ctx);
      providerField = 'local';
    }
  } else {
    analysis = localHybridEngine.analyze(normalized, ctx);
    providerField = 'local';
  }

  // d2. 引擎輸出補充（唔改引擎層）：非詞典藥名（如「拜新同」）補抽 medication intent
  analysis = supplementMedicationIntent(normalized, analysis);

  let answer = analysis.answer;
  let detailedAnswer = analysis.detailedAnswer;
  let sources = analysis.sources;
  let riskLevel = analysis.riskLevel;

  // e. 執行門控（T16，provider 無關）
  let ruleInputs: RuleInput[] = [];
  let ruleProfile: RuleProfile = {};
  let gateAnswer: string | undefined;
  let gatePending: PendingAction | undefined;
  let gateConfirmation: ConfirmationCard | undefined;
  let gateCandidates: MedCandidate[] | undefined;
  let gateContactCard: ContactCardItem[] | undefined;
  let gateOpenForm: OpenFormSuggestion | undefined;
  let gateEventId: string | undefined;
  let gateAlertId: string | undefined;

  const gate = await applyExecutionGate(elderId, analysis, ctx, persisted);
  ruleInputs = gate.ruleInputs;
  ruleProfile = gate.ruleProfile;
  gateAnswer = gate.answer;
  gatePending = gate.pending;
  gateConfirmation = gate.confirmation;
  gateCandidates = gate.candidates;
  gateOpenForm = gate.openForm;
  gateEventId = gate.eventId;
  gateAlertId = gate.alertId;
  if (gateAnswer) answer = gateAnswer;

  // e2. 家人聯絡門控（family_contact）：通知→直寫；搵／打俾→聯絡卡
  if (analysis.intent === 'family_contact') {
    const fam = await buildFamilyContactGate(elderId, normalized, persisted);
    if (fam) {
      gateAnswer = fam.answer ?? gateAnswer;
      if (fam.answer) answer = fam.answer;
      gateContactCard = fam.contactCard;
      gateEventId = gateEventId ?? fam.eventId;
      gateAlertId = gateAlertId ?? fam.alertId;
    }
  }

  // f. 查詢類 intent：真正查 DB 動態組句（門控已決定回覆時跳過）
  if (!gateAnswer) {
    if (analysis.intent === 'appointment_query' && !analysis.extractedData?.appointment?.date) {
      const built = await buildAppointmentAnswer(elderId);
      answer = built.answer;
      detailedAnswer = built.detailedAnswer ?? detailedAnswer;
    } else if (
      analysis.intent === 'health_history' ||
      (analysis.intent === 'general_health_question' && detectVitalTypes(normalized).length > 0)
    ) {
      const built = await buildHealthHistoryAnswer(elderId, normalized);
      if (built) {
        answer = built.answer;
        detailedAnswer = built.detailedAnswer ?? detailedAnswer;
      }
    } else if (analysis.intent === 'family_status_query') {
      const built = await buildFamilyStatusAnswer(elderId);
      answer = built.answer;
    }
  }

  // policy / 醫療資源 / 一般健康問題 → 知識庫搜索 + ServiceQuery
  if (
    analysis.intent === 'policy_query' ||
    analysis.intent === 'medical_resource_query' ||
    analysis.intent === 'general_health_question'
  ) {
    const kb = await handleKnowledgeQuery(
      elderId,
      normalized,
      analysis.intent,
      analysis.extractedData?.queryTopic,
      { ...analysis, answer, detailedAnswer },
      persisted,
    );
    answer = kb.answer;
    detailedAnswer = kb.detailedAnswer;
    sources = kb.sources ?? sources;
  }

  // wellbeing note（unknown 兜底）：原文存為 system Conversation
  if ((analysis.actions ?? []).some((a) => a.type === 'save_wellbeing_note') && normalized) {
    const note: Conversation = {
      id: newId(),
      elderId,
      role: 'system',
      message: `wellbeing note：${normalized}`,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    const savedNote = await provider.put<Conversation>(tableNameOf('Conversation'), note);
    addPersisted(persisted, tableNameOf('Conversation'), savedNote.id);
  }

  // g. 規則引擎 → HealthEvent → Alert。
  // 只要 ruleInputs.length > 0 就必須 evaluate（安全相關）：
  // 舊條件 `gateEventId === undefined` 會喺「通知阿仔」同血壓同句時
  // （家人聯絡門控已產生 event/alert）完全跳過規則評估，危險血壓無警報。
  // gate 已產生嘅 event/alert id 同呢度嘅結果合併（??=）。
  let eventId: string | undefined = gateEventId;
  let alertId: string | undefined = gateAlertId;
  if (ruleInputs.length > 0) {
    // history 排除本輪新寫入嘅記錄（唔會同自己比較）
    const newIds = new Set(Object.values(persisted).flat());
    const history = (
      await provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId })
    ).filter((r) => !newIds.has(r.id));
    const events = evaluate(ruleInputs, history, ruleProfile);
    if (events.length > 0) {
      for (const e of events) {
        const saved = await provider.put<HealthEvent>(tableNameOf('HealthEvent'), e);
        addPersisted(persisted, tableNameOf('HealthEvent'), saved.id);
        riskLevel = maxRisk(riskLevel, saved.severity);
      }
      const alerts = await createAlertsForEvents(events);
      for (const a of alerts) addPersisted(persisted, tableNameOf('Alert'), a.id);
      eventId ??= events[0].id;
      alertId ??= alerts[0]?.id;
    }
  }

  // h + i. 收尾寫 assistant Conversation + AuditLog，回傳
  return finish({
    answer,
    detailedAnswer,
    intent: analysis.intent,
    riskLevel,
    actions: analysis.actions ?? [],
    provider: providerField,
    eventId,
    alertId,
    sources,
    ...(gateConfirmation ? { confirmation: gateConfirmation } : {}),
    ...(gateCandidates ? { candidates: gateCandidates } : {}),
    ...(gateContactCard ? { contactCard: gateContactCard } : {}),
    ...(gateOpenForm ? { openForm: gateOpenForm } : {}),
    ...(gatePending ? { pending: gatePending } : {}),
  });
}

/** 預設實例（方便 UI import）。 */
export const assistantService = { ask };

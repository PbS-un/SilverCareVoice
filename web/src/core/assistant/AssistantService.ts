/**
 * AssistantService —— 核心管線統一入口（T5）
 *
 * ask(elderId, text, context?) 流程：
 *  a. 寫 user Conversation
 *  b. safetyScreen 先行（觸發 → urgent 路徑：建 urgent HealthEvent + Alert，
 *     answer 用 safety 模板，絕不調 LLM）
 *  c. provider 選擇：probeProxy 可達 → DeepSeekClient；失敗／驗證不過 → LocalHybridEngine
 *  d. 客戶端 zod 再驗證（DeepSeekClient 內已做）
 *  e. 按 extractedData 寫入 DB（VitalRecord / SymptomRecord / MedicationLog /
 *     Appointment / ServiceQuery + 知識庫搜索）
 *  f. 查詢類 intent（health_history / appointment_query / family_status_query）
 *     真正查 DB，answer 由實際數據動態生成，絕無固定答案
 *  g. HealthRuleEngine → HealthEvent → AlertService
 *  h. 寫 assistant Conversation + AuditLog
 *  i. 回傳 AssistantResponse
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
import { screenHighRiskTerms, type SafetyScreenResult } from './safetyScreen';
import { localHybridEngine, type AssistantContext as LocalContext } from './LocalHybridEngine';
import { chatViaProxy, probeProxy } from './DeepSeekClient';
import { evaluate, type RuleInput, type RuleProfile } from '../rules/HealthRuleEngine';
import { searchKnowledge } from '../kb/search';
import { createAlertsForEvents, listOpenAlerts } from '../../services/AlertService';

/** 統一免責聲明（UI 顯示 answer 時附加）。 */
export const HEALTH_DISCLAIMER = '以上為健康資訊，唔係醫療診斷。';

export interface AssistantContext extends LocalContext {
  /** 輸入方式（決定 VitalRecord.source），預設 'text'；語音入口傳 'voice'。 */
  source?: VitalSource;
  /** 內部用：原始輸入文字（症狀記錄 description 用）。 */
  originalText?: string;
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

/** appointment_query：查 Appointment 表，回傳下一個覆診。 */
async function buildAppointmentAnswer(elderId: string): Promise<{ answer: string; detailedAnswer?: string }> {
  const provider = getProvider();
  const now = isoNow();
  const appointments = (await provider.list<Appointment>(tableNameOf('Appointment'), { elderId }))
    .filter((a) => a.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (appointments.length === 0) {
    return { answer: '你而家冇未到期嘅覆診預約喎。如果約咗新的，話我知幫你記低呀。' };
  }
  const next = appointments[0];
  const note = next.note ? `${next.note}。` : '';
  return {
    answer: `你下次覆診係${formatDateHK(next.date)}，喺${next.location}。${note}`,
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

async function persistExtractedData(
  elderId: string,
  analysis: StructuredAnalysis,
  context: AssistantContext,
  persisted: Partial<Record<TableName, string[]>>,
): Promise<{ ruleInputs: RuleInput[]; ruleProfile: RuleProfile }> {
  const provider = getProvider();
  const ed = analysis.extractedData;
  const ruleInputs: RuleInput[] = [];
  const t = isoNow();
  const source: VitalSource = context.source ?? 'text';
  if (!ed) return { ruleInputs, ruleProfile: {} };

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

  // 生命徵象 → VitalRecord
  if (ed.bloodPressure && ed.bloodPressure.systolic !== undefined && ed.bloodPressure.diastolic !== undefined) {
    const saved = await putVital({
      type: 'blood_pressure',
      systolic: ed.bloodPressure.systolic,
      diastolic: ed.bloodPressure.diastolic,
      unit: 'mmHg',
    });
    ruleInputs.push({ kind: 'vital', record: saved, concurrentSymptoms: ed.symptoms ?? [] });
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

  // 服藥狀態 → 搵匹配 Medication，更新／建立 MedicationLog
  if (ed.medicationStatus) {
    const meds = await provider.list<Medication>(tableNameOf('Medication'), { elderId });
    let med = ed.medicationName
      ? meds.find(
          (m) => m.name.includes(ed.medicationName!) || ed.medicationName!.includes(m.name),
        )
      : meds.length === 1
        ? meds[0]
        : undefined;

    if (!med && ed.medicationName) {
      med = await provider.put<Medication>(tableNameOf('Medication'), {
        id: newId(),
        elderId,
        name: ed.medicationName,
        dosage: '未填寫',
        schedule: '未設定',
        createdAt: t,
        updatedAt: t,
      });
      addPersisted(persisted, tableNameOf('Medication'), med.id);
    }

    if (med) {
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

      const statusMap: Record<NonNullable<typeof ed.medicationStatus>, MedicationLog['status']> = {
        taken: 'taken',
        missed: 'missed',
        late: 'late',
      };
      const status = statusMap[ed.medicationStatus];

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
      ruleInputs.push({ kind: 'medication', log: savedLog, medication: med });
    }
  }

  // 預約（有日期／地點先寫；純查詢唔寫）
  if (ed.appointment && (ed.appointment.date || ed.appointment.location)) {
    const appt: Appointment = {
      id: newId(),
      elderId,
      date: ed.appointment.date ?? t,
      location: ed.appointment.location ?? '未指定',
      note: ed.appointment.note,
      createdAt: t,
      updatedAt: t,
    };
    const saved = await provider.put<Appointment>(tableNameOf('Appointment'), appt);
    addPersisted(persisted, tableNameOf('Appointment'), saved.id);
  }

  // 慢病背景（規則引擎 profile 用）
  const conditions = await provider.list<ChronicCondition>(tableNameOf('ChronicCondition'), {
    elderId,
  });
  const ruleProfile: RuleProfile = {
    chronicConditionTypes: conditions.map((c) => c.type),
  };
  return { ruleInputs, ruleProfile };
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
    const assistantConv: Conversation = {
      id: newId(),
      elderId,
      role: 'assistant',
      message: res.answer,
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

    return { ...res, persisted };
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

  // c. provider 選擇：proxy 可達 → DeepSeek；否則／失敗 → 本地引擎
  let analysis: StructuredAnalysis;
  let providerField: AssistantResponse['provider'];
  const reachable = await probeProxy();
  if (reachable) {
    const proxyResult = await chatViaProxy(normalized, { userName: ctx.userName });
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

  let answer = analysis.answer;
  let detailedAnswer = analysis.detailedAnswer;
  let sources = analysis.sources;
  let riskLevel = analysis.riskLevel;

  // e. 按 extractedData 寫入 DB
  const { ruleInputs, ruleProfile } = await persistExtractedData(
    elderId,
    analysis,
    ctx,
    persisted,
  );

  // f. 查詢類 intent：真正查 DB 動態組句
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

  // g. 規則引擎 → HealthEvent → Alert
  const newIds = new Set(
    Object.values(persisted)
      .flat(),
  );
  const history = (
    await provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId })
  ).filter((r) => !newIds.has(r.id));
  const events = evaluate(ruleInputs, history, ruleProfile);
  let eventId: string | undefined;
  let alertId: string | undefined;
  if (events.length > 0) {
    for (const e of events) {
      const saved = await provider.put<HealthEvent>(tableNameOf('HealthEvent'), e);
      addPersisted(persisted, tableNameOf('HealthEvent'), saved.id);
      riskLevel = maxRisk(riskLevel, saved.severity);
    }
    const alerts = await createAlertsForEvents(events);
    for (const a of alerts) addPersisted(persisted, tableNameOf('Alert'), a.id);
    eventId = events[0].id;
    alertId = alerts[0]?.id;
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
  });
}

/** 預設實例（方便 UI import）。 */
export const assistantService = { ask };

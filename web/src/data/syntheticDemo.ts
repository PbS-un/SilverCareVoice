/**
 * SilverCare Voice — 100 名「合成澳門長者」deterministic demo 資料（T1）
 *
 * - 固定 seed 的 PRNG（mulberry32），每次 Demo Reset 產生同一批 100 人。
 * - 第 1 位保持原有「陳婆婆」完整示範資料（所有既有測試／E2E 流程兼容）。
 * - 每名長者對應一個 account（User role:'elder'）+ 一名固定監護人（User role:'caregiver'）。
 * - 所有資料標記 isSynthetic:true（VitalRecord 沿用 source:'seed'）。
 * - 全部資料為系統生成的合成示範資料，並非真實患者資料。
 * - 不使用真實患者資料；不 hardcode 巨型 JSON。
 */

import type { SeedData } from './DataProvider';
import type {
  Alert,
  Appointment,
  AuditLog,
  Caregiver,
  CaregiverFollowUp,
  CaregiverLink,
  ChronicCondition,
  Conversation,
  ElderProfile,
  HealthEvent,
  Medication,
  MedicationLog,
  ServiceQuery,
  SymptomRecord,
  User,
  VitalRecord,
} from '../types/entities';
import { KNOWLEDGE_BASE } from './knowledgeBase';

/* ─────────────────────────── 共用時間工具 ─────────────────────────── */

/** 回傳 N 天前、指定本地時間（HH:mm）的 ISO string。 */
function iso(daysAgo: number, time = '08:00'): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** 兩週後，指定時間。 */
function isoAhead(days: number, time = '09:30'): string {
  return iso(-days, time);
}

function base(daysAgo: number, time?: string) {
  const t = iso(daysAgo, time);
  return { createdAt: t, updatedAt: t };
}

/* ─────────────────────────── 固定 seed PRNG ─────────────────────────── */

/** mulberry32：小型、可重現的 seeded PRNG。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function intBetween(rnd: () => number, min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ─────────────────────────── 姓名／資料池（全部合成） ─────────────────────────── */

const SURNAMES = [
  '陳', '李', '黃', '張', '梁', '林', '何', '吳', '鄭', '劉',
  '譚', '麥', '曾', '蘇', '朱', '蔡', '高', '余', '羅', '歐陽',
] as const;

const FEMALE_GIVEN = [
  '淑嫻', '美玲', '秀英', '桂蘭', '佩儀', '秀珍', '惠芳', '玉蓮',
  '靜儀', '群英', '少芬', '麗娟', '慧琼', '月娥', '杏芳',
] as const;

const MALE_GIVEN = [
  '國強', '志明', '永康', '建華', '德昌', '國華', '潤發', '家聲',
  '啟明', '文傑', '天佑', '兆基', '偉雄', '少波', '慶祥',
] as const;

const PT_FIRST = [
  'Maria', 'António', 'Rosa', 'José', 'Ana', 'Manuel', 'Teresa',
  'Carlos', 'Isabel', 'Francisco', 'Joaquim', 'Beatriz',
] as const;

const PT_LAST = [
  'da Silva', 'dos Santos', 'Ferreira', 'Rodrigues', 'Oliveira',
  'Costa', 'Pereira', 'Mendes', 'Almeida', 'Correia', 'Sousa', 'Martins',
] as const;

const GUARDIAN_PREFIX = ['阿', '陳', '李', '黃', '何', '梁'] as const;
const GUARDIAN_NAMES = ['美', '強', '珍', '華', '玲', '俊', '芳', '偉', '燕', '豪'] as const;
const RELATIONS = ['女兒', '兒子', '媳婦', '孫女', '孫兒', '配偶'] as const;

const ADDRESSES = [
  '澳門黑沙環', '澳門筷子基', '澳門台山', '澳門望廈', '澳門新口岸',
  '氹仔花城', '氹仔湖畔', '路環市區', '澳門沙梨頭', '澳門媽閣',
] as const;

/* ──────────────── 第 1 位：陳婆婆（原示範資料，逐字保留） ──────────────── */

const ELDER_ID = 'seed-elder-01';
const CAREGIVER_ID = 'seed-caregiver-01';
const MED_BP_ID = 'seed-med-01'; // 降壓藥（早上）
const MED_GLU_ID = 'seed-med-02'; // 降糖藥（早晚）

/** 過去 6 日血壓序列（約 132/84 → 147/91，呈上升趨勢） */
const BP_SERIES: Array<{ sys: number; dia: number }> = [
  { sys: 132, dia: 84 },
  { sys: 145, dia: 90 },
  { sys: 138, dia: 86 },
  { sys: 150, dia: 93 },
  { sys: 142, dia: 88 },
  { sys: 147, dia: 91 },
];

const elderOneVitals: VitalRecord[] = [
  ...BP_SERIES.map((bp, i) => ({
    id: `seed-vr-bp-${String(i + 1).padStart(2, '0')}`,
    elderId: ELDER_ID,
    type: 'blood_pressure' as const,
    systolic: bp.sys,
    diastolic: bp.dia,
    unit: 'mmHg',
    measuredAt: iso(5 - i, '08:10'),
    source: i % 2 === 0 ? ('voice' as const) : ('form' as const),
    ...base(5 - i, '08:12'),
  })),
  ...[
    { id: 'seed-vr-glu-01', value: 5.8, daysAgo: 5, time: '07:45' },
    { id: 'seed-vr-glu-02', value: 6.4, daysAgo: 3, time: '07:50' },
    { id: 'seed-vr-glu-03', value: 7.1, daysAgo: 1, time: '07:48' },
    { id: 'seed-vr-glu-04', value: 8.9, daysAgo: 2, time: '14:30' },
  ].map((g) => ({
    id: g.id,
    elderId: ELDER_ID,
    type: 'blood_glucose' as const,
    value: g.value,
    unit: 'mmol/L',
    measuredAt: iso(g.daysAgo, g.time),
    source: 'voice' as const,
    ...base(g.daysAgo, g.time),
  })),
  ...[
    { id: 'seed-vr-hr-01', value: 72, daysAgo: 5, time: '08:15' },
    { id: 'seed-vr-hr-02', value: 76, daysAgo: 3, time: '08:18' },
    { id: 'seed-vr-hr-03', value: 74, daysAgo: 1, time: '08:16' },
  ].map((h) => ({
    id: h.id,
    elderId: ELDER_ID,
    type: 'heart_rate' as const,
    value: h.value,
    unit: 'bpm',
    measuredAt: iso(h.daysAgo, h.time),
    source: 'form' as const,
    ...base(h.daysAgo, h.time),
  })),
  {
    id: 'seed-vr-wt-01',
    elderId: ELDER_ID,
    type: 'weight' as const,
    value: 55.2,
    unit: 'kg',
    measuredAt: iso(4, '08:20'),
    source: 'form' as const,
    ...base(4, '08:21'),
  },
];

/** 近 6 日服藥記錄（大部分 taken，一次 missed） */
function buildElderOneMedLogs(): MedicationLog[] {
  const logs: MedicationLog[] = [];
  const slots: Array<{ medId: string; time: string; key: string }> = [
    { medId: MED_BP_ID, time: '08:00', key: 'bp-am' },
    { medId: MED_GLU_ID, time: '08:00', key: 'glu-am' },
    { medId: MED_GLU_ID, time: '20:00', key: 'glu-pm' },
  ];
  let seq = 0;
  for (let daysAgo = 5; daysAgo >= 0; daysAgo -= 1) {
    for (const slot of slots) {
      seq += 1;
      const scheduledAt = iso(daysAgo, slot.time);
      const isMissed = daysAgo === 2 && slot.key === 'glu-pm';
      const id = `seed-ml-${String(seq).padStart(2, '0')}`;
      const created = iso(daysAgo, slot.time);
      if (isMissed) {
        logs.push({ id, elderId: ELDER_ID, medicationId: slot.medId, scheduledAt, status: 'missed', createdAt: created, updatedAt: created });
      } else {
        const taken = new Date(scheduledAt);
        taken.setMinutes(taken.getMinutes() + 10);
        logs.push({ id, elderId: ELDER_ID, medicationId: slot.medId, scheduledAt, takenAt: taken.toISOString(), status: 'taken', createdAt: created, updatedAt: taken.toISOString() });
      }
    }
  }
  return logs;
}

/** 陳婆婆（第 1 位）的完整 per-elder 資料（與原 seed.ts 逐字一致，另加 isSynthetic / accountCode）。 */
function buildElderOne(): {
  users: User[];
  elderProfiles: ElderProfile[];
  caregivers: Caregiver[];
  caregiverLinks: CaregiverLink[];
  chronicConditions: ChronicCondition[];
  vitalRecords: VitalRecord[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  symptomRecords: SymptomRecord[];
  appointments: Appointment[];
  healthEvents: HealthEvent[];
  alerts: Alert[];
  caregiverFollowUps: CaregiverFollowUp[];
  conversations: Conversation[];
  serviceQueries: ServiceQuery[];
  consents: import('../types/entities').Consent[];
  auditLogs: AuditLog[];
} {
  return {
    users: [
      {
        id: 'seed-user-elder',
        name: '陳婆婆',
        role: 'elder',
        phone: '+85362000001',
        refId: ELDER_ID,
        language: 'zh-HK',
        accountCode: 'demo-001',
        isSynthetic: true,
        ...base(30, '09:00'),
      },
      {
        id: 'seed-user-caregiver',
        name: '阿美',
        role: 'caregiver',
        phone: '+85362000002',
        refId: CAREGIVER_ID,
        language: 'zh-HK',
        accountCode: 'demo-001',
        isSynthetic: true,
        ...base(30, '09:05'),
      },
    ],
    elderProfiles: [
      {
        id: ELDER_ID,
        name: '陳婆婆',
        age: 78,
        chronicConditionIds: ['seed-cc-01', 'seed-cc-02'],
        language: 'zh-HK',
        address: '澳門黑沙環',
        emergencyNote: '如血壓持續偏高請聯絡女兒阿美',
        isSynthetic: true,
        ...base(30, '09:00'),
      },
    ],
    caregivers: [
      {
        id: CAREGIVER_ID,
        name: '阿美',
        relation: '女兒',
        phone: '+85362000002',
        isSynthetic: true,
        ...base(30, '09:05'),
      },
    ],
    caregiverLinks: [
      { id: 'seed-link-01', elderId: ELDER_ID, caregiverId: CAREGIVER_ID, consentGiven: true, ...base(30, '09:10') },
    ],
    chronicConditions: [
      { id: 'seed-cc-01', elderId: ELDER_ID, name: '高血壓', type: 'hypertension', ...base(30, '09:00') },
      { id: 'seed-cc-02', elderId: ELDER_ID, name: '糖尿病', type: 'diabetes', ...base(30, '09:00') },
    ],
    vitalRecords: elderOneVitals,
    medications: [
      { id: MED_BP_ID, elderId: ELDER_ID, name: '降壓藥', dosage: '1 粒', schedule: '每天早上 8 時服用', ...base(30, '09:00') },
      { id: MED_GLU_ID, elderId: ELDER_ID, name: '降糖藥', dosage: '1 粒', schedule: '每日早晚各一次（8 時及 20 時）', ...base(30, '09:00') },
    ],
    medicationLogs: buildElderOneMedLogs(),
    symptomRecords: [
      {
        id: 'seed-sym-01',
        elderId: ELDER_ID,
        symptoms: ['頭暈'],
        description: '輕微頭暈，坐低休息後好啲，無其他不適。',
        severity: 'mild',
        occurredAt: iso(1, '15:30'),
        ...base(1, '15:35'),
      },
    ],
    appointments: [
      {
        id: 'seed-appt-01',
        elderId: ELDER_ID,
        date: isoAhead(14, '09:30'),
        location: '仁伯爵綜合醫院',
        note: '內科覆診（血壓及血糖跟進），記得帶覆診卡同藥物清單。',
        ...base(10, '11:00'),
      },
    ],
    healthEvents: [
      {
        id: 'seed-he-01',
        elderId: ELDER_ID,
        type: 'bp_spike',
        severity: 'attention',
        summary: '血壓升至 150/93 mmHg，較近期水平偏高，建議留意並聯絡長者。',
        sourceRecordIds: ['seed-vr-bp-04'],
        resolvedAt: iso(2, '10:30'),
        ...base(3, '08:15'),
      },
    ],
    alerts: [
      {
        id: 'seed-alert-01',
        elderId: ELDER_ID,
        caregiverId: CAREGIVER_ID,
        healthEventId: 'seed-he-01',
        severity: 'attention',
        message: '陳婆婆今朝血壓 150/93 mmHg，比平日偏高，建議打電話關心一下。',
        status: 'resolved',
        seenAt: iso(3, '08:40'),
        resolvedAt: iso(2, '10:30'),
        ...base(3, '08:20'),
      },
    ],
    caregiverFollowUps: [
      {
        id: 'seed-fu-01',
        alertId: 'seed-alert-01',
        caregiverId: CAREGIVER_ID,
        type: 'phone',
        note: '打咗電話同媽咪傾咗，佢話無事，只係昨晚瞓得唔好。已叮佢記得食藥。',
        ...base(2, '10:25'),
      },
    ],
    conversations: [
      { id: 'seed-conv-01', elderId: ELDER_ID, role: 'elder', message: '我今日食咗降壓藥未呀？', intent: 'medication_query', ...base(0, '09:15') },
      { id: 'seed-conv-02', elderId: ELDER_ID, role: 'assistant', message: '陳婆婆，你今朝 8 點 10 分已經食咗降壓藥喇，唔使擔心。', ...base(0, '09:15') },
      { id: 'seed-conv-03', elderId: ELDER_ID, role: 'elder', message: '幫我看下覆診係幾時？', intent: 'appointment_query', ...base(1, '10:00') },
      { id: 'seed-conv-04', elderId: ELDER_ID, role: 'assistant', message: '你兩星期後朝早 9 點半喺仁伯爵綜合醫院有內科覆診，記得帶覆診卡呀。', ...base(1, '10:00') },
      { id: 'seed-conv-05', elderId: ELDER_ID, role: 'elder', message: '我琴晚覺得有少少頭暈。', intent: 'symptom_report', ...base(1, '15:30') },
    ],
    serviceQueries: [
      { id: 'seed-sq-01', elderId: ELDER_ID, query: '邊度可以量血壓？', category: '醫療服務', matchedIds: ['seed-res-03', 'seed-res-04'], ...base(2, '16:00') },
    ],
    consents: [
      {
        id: 'seed-consent-01',
        elderId: ELDER_ID,
        type: 'caregiver_data_sharing',
        granted: true,
        text: '本人同意將健康記錄摘要分享俾照顧者（女兒阿美），以便照顧同跟進。',
        ...base(30, '09:10'),
      },
    ],
    auditLogs: [
      { id: 'seed-audit-01', actor: 'system', action: 'seed.load', entityType: 'all', entityId: '-', detail: '載入陳婆婆 demo 種子資料', ...base(0, '00:01') },
      { id: 'seed-audit-02', actor: 'seed-user-elder', action: 'consent.grant', entityType: 'Consent', entityId: 'seed-consent-01', detail: '長者同意向照顧者分享健康摘要', ...base(30, '09:10') },
      { id: 'seed-audit-03', actor: 'seed-user-caregiver', action: 'alert.resolve', entityType: 'Alert', entityId: 'seed-alert-01', detail: '照顧者確認跟進完成', ...base(2, '10:30') },
    ],
  };
}

/* ─────────────────────────── 第 2–100 位生成器 ─────────────────────────── */

interface ConditionSpec {
  name: string;
  type: ChronicCondition['type'];
}

const CONDITION_POOL: Array<{ spec: ConditionSpec; weight: number }> = [
  { spec: { name: '高血壓', type: 'hypertension' }, weight: 52 },
  { spec: { name: '糖尿病', type: 'diabetes' }, weight: 34 },
  { spec: { name: '高血脂', type: 'other' }, weight: 22 },
  { spec: { name: '心律問題', type: 'heart_disease' }, weight: 12 },
  { spec: { name: '肥胖', type: 'other' }, weight: 14 },
  { spec: { name: '骨關節問題', type: 'other' }, weight: 18 },
];

const MED_POOL: Array<{ name: string; dosage: string; schedule: string; forCondition: string }> = [
  { name: '降壓藥', dosage: '1 粒', schedule: '每天早上 8 時服用', forCondition: '高血壓' },
  { name: '降糖藥', dosage: '1 粒', schedule: '每日早晚各一次（8 時及 20 時）', forCondition: '糖尿病' },
  { name: '降脂藥', dosage: '1 粒', schedule: '每晚睡前服用', forCondition: '高血脂' },
  { name: '薄血藥', dosage: '半粒', schedule: '每天早上 8 時服用', forCondition: '心律問題' },
  { name: '關節藥', dosage: '1 粒', schedule: '每日兩次（早餐後及晚餐後）', forCondition: '骨關節問題' },
];

const SYMPTOM_POOL: Array<{ symptoms: string[]; severity: SymptomRecord['severity']; description: string }> = [
  { symptoms: ['頭暈'], severity: 'mild', description: '起身時輕微頭暈，坐低休息後好啲。' },
  { symptoms: ['關節痛'], severity: 'mild', description: '膝頭有時痠痛，落雨嗰日明顯啲。' },
  { symptoms: ['疲勞'], severity: 'mild', description: '近日覺得攰，瞓覺時間有啲亂。' },
  { symptoms: ['失眠'], severity: 'mild', description: '夜晚瞓得唔好，醒咗好難再瞓。' },
  { symptoms: ['頭痛'], severity: 'mild', description: '偶然頭痛，休息後舒緩。' },
  { symptoms: ['氣促'], severity: 'moderate', description: '行樓梯有時氣促，要停下抖氣。' },
];

function buildGeneratedElder(
  rnd: () => number,
  index: number,
): {
  users: User[];
  elderProfiles: ElderProfile[];
  caregivers: Caregiver[];
  caregiverLinks: CaregiverLink[];
  chronicConditions: ChronicCondition[];
  vitalRecords: VitalRecord[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  symptomRecords: SymptomRecord[];
  appointments: Appointment[];
  healthEvents: HealthEvent[];
  alerts: Alert[];
  caregiverFollowUps: CaregiverFollowUp[];
  conversations: Conversation[];
  serviceQueries: ServiceQuery[];
  consents: import('../types/entities').Consent[];
  auditLogs: AuditLog[];
} {
  const n = String(index).padStart(3, '0');
  const elderId = `seed-elder-${n}`;
  const caregiverId = `seed-caregiver-${n}`;
  const code = `demo-${n}`;

  // 名字：約 8% 葡文姓名，其餘中文
  const female = rnd() < 0.55;
  const isPt = rnd() < 0.08;
  const name = isPt
    ? `${pick(rnd, PT_FIRST)} ${pick(rnd, PT_LAST)}`
    : `${pick(rnd, SURNAMES)}${female ? pick(rnd, FEMALE_GIVEN) : pick(rnd, MALE_GIVEN)}`;
  const age = intBetween(rnd, 65, 95);
  const address = pick(rnd, ADDRESSES);

  // 慢病（可多個；約 22% 無重大慢病）
  const rolledConditions: ConditionSpec[] = [];
  const roll = rnd();
  if (roll > 0.22) {
    for (const c of CONDITION_POOL) {
      if (rnd() * 100 < c.weight) rolledConditions.push(c.spec);
    }
  }
  const seenCondition = new Set<string>();
  const conditions: ConditionSpec[] = [];
  for (const c of rolledConditions) {
    if (!seenCondition.has(c.name)) {
      seenCondition.add(c.name);
      conditions.push(c);
    }
  }
  const hasHtn = conditions.some((c) => c.type === 'hypertension');
  const hasDm = conditions.some((c) => c.type === 'diabetes');

  // 監護人
  const guardianName = `${pick(rnd, GUARDIAN_PREFIX)}${pick(rnd, GUARDIAN_NAMES)}`;
  const relation = pick(rnd, RELATIONS);
  const caregiverPhone = `+8536${String(10000000 + Math.floor(rnd() * 89999999))}`;

  const vitalRecords: VitalRecord[] = [];
  const mk = (daysAgo: number, time: string): string => iso(daysAgo, time);

  // 血壓：8 筆（28 日內），隨機漫步，高血壓者基線較高
  let sys = hasHtn ? intBetween(rnd, 128, 148) : intBetween(rnd, 112, 132);
  for (let i = 0; i < 8; i += 1) {
    sys = Math.min(175, Math.max(95, sys + intBetween(rnd, -7, 7)));
    const dia = Math.min(105, Math.max(58, Math.round(sys * 0.58) + intBetween(rnd, -3, 3)));
    const daysAgo = 28 - i * 4 + intBetween(rnd, 0, 2);
    const at = mk(daysAgo, '08:10');
    vitalRecords.push({
      id: `seed-vr-${n}-bp-${i + 1}`,
      elderId,
      type: 'blood_pressure',
      systolic: sys,
      diastolic: dia,
      unit: 'mmHg',
      measuredAt: at,
      source: 'seed',
      ...base(daysAgo, '08:12'),
    });
  }
  // 血糖：5 筆（空腹為主；糖尿病人偏高）
  const gluBase = hasDm ? 6.8 : 5.2;
  for (let i = 0; i < 5; i += 1) {
    const daysAgo = 21 - i * 5;
    const at = mk(daysAgo, '07:45');
    vitalRecords.push({
      id: `seed-vr-${n}-glu-${i + 1}`,
      elderId,
      type: 'blood_glucose',
      value: round1(Math.max(4.2, gluBase + (rnd() - 0.45) * 2.2)),
      unit: 'mmol/L',
      measuredAt: at,
      source: 'seed',
      ...base(daysAgo, '07:48'),
    });
  }
  // 心率：4 筆
  for (let i = 0; i < 4; i += 1) {
    const daysAgo = 18 - i * 5;
    const at = mk(daysAgo, '08:15');
    vitalRecords.push({
      id: `seed-vr-${n}-hr-${i + 1}`,
      elderId,
      type: 'heart_rate',
      value: intBetween(rnd, 62, 92),
      unit: 'bpm',
      measuredAt: at,
      source: 'seed',
      ...base(daysAgo, '08:18'),
    });
  }
  // 體重：3 筆
  const weight = round1(45 + rnd() * 40);
  for (let i = 0; i < 3; i += 1) {
    const daysAgo = 21 - i * 7;
    const at = mk(daysAgo, '08:20');
    vitalRecords.push({
      id: `seed-vr-${n}-wt-${i + 1}`,
      elderId,
      type: 'weight',
      value: round1(weight + (rnd() - 0.5) * 1.2),
      unit: 'kg',
      measuredAt: at,
      source: 'seed',
      ...base(daysAgo, '08:21'),
    });
  }

  // 藥物：0–3 種（跟慢病對應；無慢病仍可能有 1 種保健）
  const meds: Medication[] = [];
  const medLogs: MedicationLog[] = [];
  const medNames = new Set<string>();
  const conditionNames = new Set(conditions.map((c) => c.name));
  const medCount = conditions.length > 0 ? Math.min(conditions.length, 3) : rnd() < 0.4 ? 1 : 0;
  for (let i = 0; i < medCount; i += 1) {
    const candidate = MED_POOL.find((m) => conditionNames.has(m.forCondition) && !medNames.has(m.name))
      ?? MED_POOL.find((m) => !medNames.has(m.name));
    if (!candidate) break;
    medNames.add(candidate.name);
    const medId = `seed-med-${n}-${i + 1}`;
    meds.push({
      id: medId,
      elderId,
      name: candidate.name,
      dosage: candidate.dosage,
      schedule: candidate.schedule,
      ...base(30, '09:00'),
    });
    // 近 6 日服藥記錄
    const slots = candidate.name === '降糖藥' ? ['08:00', '20:00'] : [candidate.schedule.includes('睡前') ? '21:30' : '08:00'];
    for (let d = 5; d >= 0; d -= 1) {
      for (const slot of slots) {
        const scheduledAt = mk(d, slot);
        const missRoll = rnd();
        const status: MedicationLog['status'] = missRoll < 0.08 ? 'missed' : missRoll < 0.1 ? 'late' : 'taken';
        const takenAt = status === 'taken' || status === 'late' ? new Date(new Date(scheduledAt).getTime() + 10 * 60000).toISOString() : undefined;
        medLogs.push({
          id: `seed-ml-${n}-${meds.length}-${d}-${slot.replace(':', '')}`,
          elderId,
          medicationId: medId,
          scheduledAt,
          ...(takenAt ? { takenAt } : {}),
          status,
          ...base(d, slot),
        });
      }
    }
  }

  // 症狀：0–2 筆
  const symptomRecords: SymptomRecord[] = [];
  const symptomCount = rnd() < 0.5 ? (rnd() < 0.35 ? 2 : 1) : 0;
  const usedSymptoms = new Set<string>();
  for (let i = 0; i < symptomCount; i += 1) {
    const s = pick(rnd, SYMPTOM_POOL);
    if (usedSymptoms.has(s.symptoms[0])) continue;
    usedSymptoms.add(s.symptoms[0]);
    const daysAgo = intBetween(rnd, 1, 10);
    symptomRecords.push({
      id: `seed-sym-${n}-${i + 1}`,
      elderId,
      symptoms: s.symptoms,
      description: s.description,
      severity: s.severity,
      occurredAt: mk(daysAgo, '15:30'),
      ...base(daysAgo, '15:35'),
    });
  }

  // 覆診：0–2 筆
  const appointments: Appointment[] = [];
  const apptCount = rnd() < 0.55 ? (rnd() < 0.3 ? 2 : 1) : 0;
  const LOCATIONS = ['黑沙環衛生中心', '仁伯爵綜合醫院', '鏡湖醫院', '氹仔衛生中心', '筷子基衛生中心'];
  const SPECIALTIES = ['內科', '眼科', '骨科', '糖尿病科', '心臟科'];
  for (let i = 0; i < apptCount; i += 1) {
    appointments.push({
      id: `seed-appt-${n}-${i + 1}`,
      elderId,
      date: isoAhead(intBetween(rnd, 7, 40), '09:30'),
      location: pick(rnd, LOCATIONS),
      specialty: pick(rnd, SPECIALTIES),
      note: '定期覆診跟進，記得帶覆診卡。',
      ...base(intBetween(rnd, 3, 20), '11:00'),
    });
  }

  // HealthEvent / Alert：約 40% 有一次 attention 事件；其中約 20% 未解決（需要家庭跟進）
  const healthEvents: HealthEvent[] = [];
  const alerts: Alert[] = [];
  const caregiverFollowUps: CaregiverFollowUp[] = [];
  const lastBp = vitalRecords[vitalRecords.length - 1] as VitalRecord | undefined;
  const hasEvent = rnd() < 0.4;
  if (hasEvent && lastBp) {
    const eventType = rnd() < 0.6 ? 'bp_elevated' : 'symptom_reported';
    const severity: HealthEvent['severity'] = rnd() < 0.18 ? 'attention' : 'normal';
    const eventId = `seed-he-${n}-01`;
    const daysAgo = intBetween(rnd, 0, 7);
    const summary =
      eventType === 'bp_elevated'
        ? `血壓 ${lastBp.systolic}/${lastBp.diastolic} mmHg，較平日略高，建議留意。`
        : '出現輕微不適症狀，已記錄並提醒留意。';
    const isOpen = rnd() < 0.2;
    healthEvents.push({
      id: eventId,
      elderId,
      type: eventType,
      severity,
      summary,
      sourceRecordIds: [lastBp.id],
      ...(isOpen ? {} : { resolvedAt: mk(daysAgo, '18:00') }),
      ...base(daysAgo, '08:15'),
    });
    alerts.push({
      id: `seed-alert-${n}-01`,
      elderId,
      caregiverId,
      healthEventId: eventId,
      severity,
      message: `${name}嘅健康情況需要留意：${summary}`,
      status: isOpen ? 'open' : 'resolved',
      ...(isOpen ? {} : { seenAt: mk(daysAgo, '09:00'), resolvedAt: mk(daysAgo, '18:00') }),
      ...base(daysAgo, '08:20'),
    });
    if (!isOpen) {
      caregiverFollowUps.push({
        id: `seed-fu-${n}-01`,
        alertId: `seed-alert-${n}-01`,
        caregiverId,
        type: 'phone',
        note: `${guardianName}已致電長者了解情況，叮囑休息及按時食藥。`,
        ...base(daysAgo, '17:55'),
      });
    }
  }

  // 對話：0–2 組（提供歷史上下文，AI memory 使用）
  const conversations: Conversation[] = [];
  const convCount = rnd() < 0.6 ? (rnd() < 0.4 ? 2 : 1) : 0;
  for (let i = 0; i < convCount; i += 1) {
    const daysAgo = intBetween(rnd, 0, 5);
    const q = pick(rnd, [
      '我今日有啲攰。',
      '記低我今朝血壓。',
      '我食咗藥喇。',
      '幾時覆診呀？',
      '今日覺得幾好。',
    ] as const);
    conversations.push({ id: `seed-conv-${n}-${i * 2 + 1}`, elderId, role: 'elder', message: q, intent: 'general_health_question', ...base(daysAgo, '09:00') });
    conversations.push({ id: `seed-conv-${n}-${i * 2 + 2}`, elderId, role: 'assistant', message: '好嘅，我幫你記低咗，有唔舒服記得話我知。', ...base(daysAgo, '09:00') });
  }

  // ServiceQuery / Consent / AuditLog
  const serviceQueries: ServiceQuery[] =
    rnd() < 0.3
      ? [
          {
            id: `seed-sq-${n}-01`,
            elderId,
            query: '邊度可以量血壓？',
            category: '醫療服務',
            matchedIds: ['seed-res-03', 'seed-res-04'],
            ...base(intBetween(rnd, 1, 8), '16:00'),
          },
        ]
      : [];

  const consents: import('../types/entities').Consent[] = [
    {
      id: `seed-consent-${n}-01`,
      elderId,
      type: 'caregiver_data_sharing',
      granted: true,
      text: `本人同意將健康記錄摘要分享俾照顧者（${guardianName}），以便照顧同跟進。`,
      ...base(30, '09:10'),
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: `seed-audit-${n}-01`,
      actor: 'system',
      action: 'seed.load',
      entityType: 'all',
      entityId: '-',
      detail: `載入合成長者 ${name} 嘅示範資料（isSynthetic）`,
      ...base(0, '00:01'),
    },
  ];

  return {
    users: [
      { id: `seed-user-elder-${n}`, name, role: 'elder', phone: `+8536${String(10000000 + index * 137)}`, refId: elderId, language: 'zh-HK', accountCode: code, isSynthetic: true, ...base(30, '09:00') },
      { id: `seed-user-caregiver-${n}`, name: guardianName, role: 'caregiver', phone: caregiverPhone, refId: caregiverId, language: 'zh-HK', accountCode: code, isSynthetic: true, ...base(30, '09:05') },
    ],
    elderProfiles: [
      { id: elderId, name, age, chronicConditionIds: conditions.map((_, i) => `seed-cc-${n}-${i + 1}`), language: 'zh-HK', address, emergencyNote: `如健康情況有變化，請聯絡${relation}${guardianName}。`, isSynthetic: true, ...base(30, '09:00') },
    ],
    caregivers: [
      { id: caregiverId, name: guardianName, relation, phone: caregiverPhone, isSynthetic: true, ...base(30, '09:05') },
    ],
    caregiverLinks: [
      { id: `seed-link-${n}-01`, elderId, caregiverId, consentGiven: true, ...base(30, '09:10') },
    ],
    chronicConditions: conditions.map((c, i) => ({
      id: `seed-cc-${n}-${i + 1}`,
      elderId,
      name: c.name,
      type: c.type,
      ...base(30, '09:00'),
    })),
    vitalRecords,
    medications: meds,
    medicationLogs: medLogs,
    symptomRecords,
    appointments,
    healthEvents,
    alerts,
    caregiverFollowUps,
    conversations,
    serviceQueries,
    consents,
    auditLogs,
  };
}

/* ─────────────────────────── 合併為 100 人 SeedData ─────────────────────────── */

type ElderPart = {
  users: User[];
  elderProfiles: ElderProfile[];
  caregivers: Caregiver[];
  caregiverLinks: CaregiverLink[];
  chronicConditions: ChronicCondition[];
  vitalRecords: VitalRecord[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  symptomRecords: SymptomRecord[];
  appointments: Appointment[];
  healthEvents: HealthEvent[];
  alerts: Alert[];
  caregiverFollowUps: CaregiverFollowUp[];
  conversations: Conversation[];
  serviceQueries: ServiceQuery[];
  consents: SeedData['consents'];
  auditLogs: AuditLog[];
};

/** 建立完整 100 名合成長者 Demo seed（deterministic；第 1 位為原有陳婆婆資料）。 */
export function buildDemoSeed(): SeedData {
  const rnd = mulberry32(20260806);
  const one: ElderPart = buildElderOne();
  const rest: ElderPart[] = Array.from({ length: 99 }, (_, i) => buildGeneratedElder(rnd, i + 2));

  const parts = [one, ...rest];
  const merge = <K extends keyof ElderPart>(key: K): ElderPart[K] =>
    parts.flatMap((p) => p[key] as unknown[]) as ElderPart[K];

  return {
    users: merge('users'),
    elderProfiles: merge('elderProfiles'),
    caregivers: merge('caregivers'),
    caregiverLinks: merge('caregiverLinks'),
    chronicConditions: merge('chronicConditions'),
    vitalRecords: merge('vitalRecords'),
    medications: merge('medications'),
    medicationLogs: merge('medicationLogs'),
    symptomRecords: merge('symptomRecords'),
    appointments: merge('appointments'),
    healthEvents: merge('healthEvents'),
    alerts: merge('alerts'),
    caregiverFollowUps: merge('caregiverFollowUps'),
    conversations: merge('conversations'),
    serviceQueries: merge('serviceQueries'),
    consents: merge('consents'),
    auditLogs: merge('auditLogs'),
    resourceDirectory: [
      {
        id: 'seed-res-01',
        name: '仁伯爵綜合醫院（山頂醫院）',
        category: '公立醫院',
        address: '澳門若憲馬路',
        phone: '28313731',
        hours: '急診 24 小時',
        region: '澳門半島',
        ...base(60, '12:00'),
      },
      {
        id: 'seed-res-02',
        name: '鏡湖醫院',
        category: '私立醫院',
        address: '澳門連勝街',
        phone: '28371333',
        hours: '急診 24 小時',
        region: '澳門半島',
        ...base(60, '12:00'),
      },
      {
        id: 'seed-res-03',
        name: '黑沙環衛生中心',
        category: '衛生中心',
        address: '澳門黑沙環馬路',
        phone: '28481868',
        hours: '週一至週五 09:00-13:00 / 14:30-17:45',
        region: '澳門半島',
        ...base(60, '12:00'),
      },
      {
        id: 'seed-res-04',
        name: '筷子基衛生中心',
        category: '衛生中心',
        address: '澳門筷子基社屋快達樓',
        phone: '28221049',
        hours: '週一至週五 09:00-13:00 / 14:30-17:45',
        region: '澳門半島',
        ...base(60, '12:00'),
      },
      {
        id: 'seed-res-05',
        name: '氹仔衛生中心',
        category: '衛生中心',
        address: '氹仔布拉干薩街',
        phone: '28827133',
        hours: '週一至週五 09:00-13:00 / 14:30-17:45',
        region: '氹仔',
        ...base(60, '12:00'),
      },
      {
        id: 'seed-res-06',
        name: '澳門鏡湖護理學院社區健康服務',
        category: '社區護理',
        address: '澳門馬六甲街',
        phone: '28371333',
        hours: '週一至週五 09:00-17:30',
        region: '澳門半島',
        ...base(60, '12:00'),
      },
    ],
    knowledgeDocuments: [...KNOWLEDGE_BASE],
  };
}

/** 預設 demo seed（模組載入時建立一次；Demo Reset 與首啟 seed 共用）。 */
export const seedData: SeedData = buildDemoSeed();

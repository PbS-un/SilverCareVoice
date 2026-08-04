/**
 * SilverCare Voice — 陳婆婆完整 Demo 種子資料（T2）
 *
 * 所有 ID 用穩定前綴（'seed-*'），方便測試斷言與 reset 還原。
 * 時間一律 ISO-8601 string，並相對「現在」動態生成（確保 demo 任何一天都合理）。
 * KnowledgeDocument 由 T9 任務導入：內容定義於 ./knowledgeBase.ts，
 * 此處直接併入 seed；ensureKnowledgeLoaded() 亦會在表為空時冪等補導。
 */

import type { SeedData } from './DataProvider';
import type { MedicationLog } from '../types/entities';
import { KNOWLEDGE_BASE } from './knowledgeBase';

const ELDER_ID = 'seed-elder-01';
const CAREGIVER_ID = 'seed-caregiver-01';
const MED_BP_ID = 'seed-med-01'; // 降壓藥（早上）
const MED_GLU_ID = 'seed-med-02'; // 降糖藥（早晚）

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

/* ──────────────── 過去 6 日血壓序列（約 132/84 → 147/91，呈上升趨勢） ──────────────── */

const BP_SERIES: Array<{ sys: number; dia: number }> = [
  { sys: 132, dia: 84 },
  { sys: 145, dia: 90 },
  { sys: 138, dia: 86 },
  { sys: 150, dia: 93 },
  { sys: 142, dia: 88 },
  { sys: 147, dia: 91 },
];

const vitalRecords = BP_SERIES.map((bp, i) => ({
  id: `seed-vr-bp-${String(i + 1).padStart(2, '0')}`,
  elderId: ELDER_ID,
  type: 'blood_pressure' as const,
  systolic: bp.sys,
  diastolic: bp.dia,
  unit: 'mmHg',
  measuredAt: iso(5 - i, '08:10'),
  source: i % 2 === 0 ? ('voice' as const) : ('form' as const),
  ...base(5 - i, '08:12'),
}));

// 血糖（空腹 mmol/L）與心率、體重各數筆
const glucoseExtras = [
  { id: 'seed-vr-glu-01', value: 5.8, daysAgo: 5, time: '07:45' },
  { id: 'seed-vr-glu-02', value: 6.4, daysAgo: 3, time: '07:50' },
  { id: 'seed-vr-glu-03', value: 7.1, daysAgo: 1, time: '07:48' },
  { id: 'seed-vr-glu-04', value: 8.9, daysAgo: 2, time: '14:30' }, // 飯後
].map((g) => ({
  id: g.id,
  elderId: ELDER_ID,
  type: 'blood_glucose' as const,
  value: g.value,
  unit: 'mmol/L',
  measuredAt: iso(g.daysAgo, g.time),
  source: 'voice' as const,
  ...base(g.daysAgo, g.time),
}));

const heartRateExtras = [
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
}));

const weightExtras = [
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

/* ──────────────── 近 6 日服藥記錄（大部分 taken，一次 missed） ──────────────── */

function buildMedicationLogs(): MedicationLog[] {
  const logs: MedicationLog[] = [];
  // 排程：降壓藥 08:00；降糖藥 08:00 / 20:00
  const slots: Array<{ medId: string; time: string; key: string }> = [
    { medId: MED_BP_ID, time: '08:00', key: 'bp-am' },
    { medId: MED_GLU_ID, time: '08:00', key: 'glu-am' },
    { medId: MED_GLU_ID, time: '20:00', key: 'glu-pm' },
  ];
  let seq = 0;
  for (let daysAgo = 5; daysAgo >= 0; daysAgo--) {
    for (const slot of slots) {
      seq += 1;
      const scheduledAt = iso(daysAgo, slot.time);
      // 唯一一次 missed：2 天前晚間降糖藥
      const isMissed = daysAgo === 2 && slot.key === 'glu-pm';
      const id = `seed-ml-${String(seq).padStart(2, '0')}`;
      const created = iso(daysAgo, slot.time);
      if (isMissed) {
        logs.push({
          id,
          elderId: ELDER_ID,
          medicationId: slot.medId,
          scheduledAt,
          status: 'missed',
          createdAt: created,
          updatedAt: created,
        });
      } else {
        // 約 10 分鐘後服用
        const taken = new Date(scheduledAt);
        taken.setMinutes(taken.getMinutes() + 10);
        logs.push({
          id,
          elderId: ELDER_ID,
          medicationId: slot.medId,
          scheduledAt,
          takenAt: taken.toISOString(),
          status: 'taken',
          createdAt: created,
          updatedAt: taken.toISOString(),
        });
      }
    }
  }
  return logs;
}

const medicationLogs = buildMedicationLogs();

/* ──────────────── 完整種子 ──────────────── */

export const seedData: SeedData = {
  users: [
    {
      id: 'seed-user-elder',
      name: '陳婆婆',
      role: 'elder',
      phone: '+85362000001',
      refId: ELDER_ID,
      language: 'zh-HK',
      ...base(30, '09:00'),
    },
    {
      id: 'seed-user-caregiver',
      name: '阿美',
      role: 'caregiver',
      phone: '+85362000002',
      refId: CAREGIVER_ID,
      language: 'zh-HK',
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
      ...base(30, '09:00'),
    },
  ],

  caregivers: [
    {
      id: CAREGIVER_ID,
      name: '阿美',
      relation: '女兒',
      phone: '+85362000002',
      ...base(30, '09:05'),
    },
  ],

  caregiverLinks: [
    {
      id: 'seed-link-01',
      elderId: ELDER_ID,
      caregiverId: CAREGIVER_ID,
      consentGiven: true,
      ...base(30, '09:10'),
    },
  ],

  chronicConditions: [
    {
      id: 'seed-cc-01',
      elderId: ELDER_ID,
      name: '高血壓',
      type: 'hypertension',
      ...base(30, '09:00'),
    },
    {
      id: 'seed-cc-02',
      elderId: ELDER_ID,
      name: '糖尿病',
      type: 'diabetes',
      ...base(30, '09:00'),
    },
  ],

  vitalRecords: [...vitalRecords, ...glucoseExtras, ...heartRateExtras, ...weightExtras],

  medications: [
    {
      id: MED_BP_ID,
      elderId: ELDER_ID,
      name: '降壓藥',
      dosage: '1 粒',
      schedule: '每天早上 8 時服用',
      ...base(30, '09:00'),
    },
    {
      id: MED_GLU_ID,
      elderId: ELDER_ID,
      name: '降糖藥',
      dosage: '1 粒',
      schedule: '每日早晚各一次（8 時及 20 時）',
      ...base(30, '09:00'),
    },
  ],

  medicationLogs,

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
    {
      id: 'seed-conv-01',
      elderId: ELDER_ID,
      role: 'elder',
      message: '我今日食咗降壓藥未呀？',
      intent: 'medication_query',
      ...base(0, '09:15'),
    },
    {
      id: 'seed-conv-02',
      elderId: ELDER_ID,
      role: 'assistant',
      message: '陳婆婆，你今朝 8 點 10 分已經食咗降壓藥喇，唔使擔心。',
      ...base(0, '09:15'),
    },
    {
      id: 'seed-conv-03',
      elderId: ELDER_ID,
      role: 'elder',
      message: '幫我看下覆診係幾時？',
      intent: 'appointment_query',
      ...base(1, '10:00'),
    },
    {
      id: 'seed-conv-04',
      elderId: ELDER_ID,
      role: 'assistant',
      message: '你兩星期後朝早 9 點半喺仁伯爵綜合醫院有內科覆診，記得帶覆診卡呀。',
      ...base(1, '10:00'),
    },
    {
      id: 'seed-conv-05',
      elderId: ELDER_ID,
      role: 'elder',
      message: '我琴晚覺得有少少頭暈。',
      intent: 'symptom_report',
      ...base(1, '15:30'),
    },
  ],

  serviceQueries: [
    {
      id: 'seed-sq-01',
      elderId: ELDER_ID,
      query: '邊度可以量血壓？',
      category: '醫療服務',
      matchedIds: ['seed-res-03', 'seed-res-04'],
      ...base(2, '16:00'),
    },
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
    {
      id: 'seed-audit-01',
      actor: 'system',
      action: 'seed.load',
      entityType: 'all',
      entityId: '-',
      detail: '載入陳婆婆 demo 種子資料',
      ...base(0, '00:01'),
    },
    {
      id: 'seed-audit-02',
      actor: 'seed-user-elder',
      action: 'consent.grant',
      entityType: 'Consent',
      entityId: 'seed-consent-01',
      detail: '長者同意向照顧者分享健康摘要',
      ...base(30, '09:10'),
    },
    {
      id: 'seed-audit-03',
      actor: 'seed-user-caregiver',
      action: 'alert.resolve',
      entityType: 'Alert',
      entityId: 'seed-alert-01',
      detail: '照顧者確認跟進完成',
      ...base(2, '10:30'),
    },
  ],

  /**
   * 澳門醫療資源（電話為常見公開值，僅供演示，上線前需核實）。
   * 來源：澳門衛生局／醫院對外公開資料。
   */
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

  /** 澳門長者知識庫（T9）：policy / health / service 共 31 條。 */
  knowledgeDocuments: [...KNOWLEDGE_BASE],
};

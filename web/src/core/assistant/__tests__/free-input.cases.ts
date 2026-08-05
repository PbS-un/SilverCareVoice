/**
 * 自由輸入 fixture 套件（T10 規範：20–30 條以上不同寫法）。
 *
 * 覆蓋：同義表達、口語粵語、書面繁中、數字格式變體（155/92、155 92、
 * 高壓／低壓、收縮壓／舒張壓、中文數字降級）、服藥（食咗／漏咗／遲咗）、
 * 覆診查詢、政策查詢（津貼／交通補貼／醫療券／長者咭）、服務查詢（附近醫院）、
 * 家屬（個女知唔知）、健康史（最近血壓／血糖紀錄）、wellbeing 自由句、高風險句。
 *
 * 與 localHybridEngine.test.ts / intent.test.ts 嘅樣本完全唔重複。
 */
import type { Intent, RiskLevel } from '../../../types/ai'

export interface FreeInputCase {
  /** 唯一識別（測試報告用） */
  id: string
  /** 自由輸入原文 */
  input: string
  /** intent 必須命中其中一個（同義表達容許多個合理歸類） */
  intents: Intent[]
  /** 明確預期嘅風險等級（唔填就斷言唔係 urgent，除非標記 highRisk） */
  riskLevel?: RiskLevel
  /** 高風險句：必須 urgent + notify_family/emergency_call */
  highRisk?: boolean
  /** 結構化抽取斷言（有先斷言） */
  expectExtracted?: {
    bloodPressure?: { systolic: number; diastolic: number }
    bloodGlucose?: number
    heartRate?: number
    weight?: number
    medicationStatus?: 'taken' | 'missed' | 'late'
    medicationName?: string
    symptomsContains?: string[]
    /** 斷言呢句話唔應該抽取到血壓（例：中文數字寫法） */
    noBloodPressure?: boolean
  }
  /**
   * 執行門控（T16）：非名單藥物唔會靜默建藥，
   * 改為提議新增（confirmation pending + openForm medication）。
   */
  proposeNewMed?: string
  /** actions 必須包含嘅 type */
  actionsContains?: string[]
}

export const FREE_INPUT_CASES: readonly FreeInputCase[] = [
  /* ---------------- 血壓數字格式變體 ---------------- */
  {
    id: 'bp-slash',
    input: '幫我記低，血壓155/92',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 155, diastolic: 92 } },
  },
  {
    id: 'bp-up-down',
    input: '血壓係155上92落',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 155, diastolic: 92 } },
  },
  {
    id: 'bp-space',
    input: '啱啱量到155 92',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 155, diastolic: 92 } },
  },
  {
    id: 'bp-high-low-label',
    input: '高壓155，低壓92',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 155, diastolic: 92 } },
  },
  {
    id: 'bp-systolic-diastolic',
    input: '收縮壓155舒張壓92',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 155, diastolic: 92 } },
  },
  {
    id: 'bp-dash',
    input: '今日血壓148-89',
    intents: ['vital_record'],
    riskLevel: 'attention',
    expectExtracted: { bloodPressure: { systolic: 148, diastolic: 89 } },
  },
  {
    id: 'bp-normal-unit',
    input: '今朝早量血壓係132/85 mmHg',
    intents: ['vital_record'],
    riskLevel: 'normal',
    expectExtracted: { bloodPressure: { systolic: 132, diastolic: 85 } },
  },
  {
    id: 'bp-chinese-numerals-graceful',
    input: '血壓一百五十五上九十二',
    // 中文數字未支援抽取 → 唔可以亂抽，但必須合理回應、唔報錯
    intents: ['general_health_question', 'health_history', 'vital_record'],
    riskLevel: 'normal',
    expectExtracted: { noBloodPressure: true },
  },

  /* ---------------- 其他生命體徵 ---------------- */
  {
    id: 'glucose-fasting',
    input: '今朝空腹血糖7.8',
    intents: ['vital_record'],
    riskLevel: 'normal',
    expectExtracted: { bloodGlucose: 7.8 },
  },
  {
    id: 'heart-rate',
    input: '心跳每分鐘96下',
    intents: ['vital_record'],
    riskLevel: 'normal',
    expectExtracted: { heartRate: 96 },
  },
  {
    id: 'weight-pounds',
    input: '我今日體重110磅',
    intents: ['vital_record'],
    riskLevel: 'normal',
    // 磅 → 公斤自動換算（110 lb ≈ 49.9 kg）
    expectExtracted: { weight: 49.9 },
  },

  /* ---------------- 服藥：食咗／漏咗／遲咗 ---------------- */
  {
    id: 'med-taken-cantonese',
    input: '我已經食咗降壓藥啦',
    intents: ['medication_taken'],
    riskLevel: 'normal',
    expectExtracted: { medicationStatus: 'taken', medicationName: '降壓藥' },
  },
  {
    id: 'med-missed-forgot',
    input: '唔記得食今朝啲藥',
    intents: ['medication_missed'],
    riskLevel: 'normal',
    expectExtracted: { medicationStatus: 'missed' },
  },
  {
    id: 'med-late',
    input: '今日遲咗食薄血藥',
    intents: ['medication_missed'],
    riskLevel: 'normal',
    // T16 門控：「薄血藥」唔喺藥物名單 → 唔靜默建藥，提議新增
    proposeNewMed: '薄血藥',
  },
  {
    id: 'med-missed-cholesterol',
    input: '漏咗食膽固醇藥',
    intents: ['medication_missed'],
    riskLevel: 'normal',
    // T16 門控：非名單藥物 → 提議新增（唔自動建藥）
    proposeNewMed: '膽固醇藥',
  },
  {
    id: 'med-missed-sleeping-written',
    input: '昨晚忘了吃安眠藥',
    intents: ['medication_missed'],
    riskLevel: 'normal',
    // T16 門控：非名單藥物 → 提議新增（唔自動建藥）
    proposeNewMed: '安眠藥',
  },
  {
    id: 'med-taken-written',
    input: '已經服咗糖尿藥',
    intents: ['medication_taken'],
    riskLevel: 'normal',
    expectExtracted: { medicationStatus: 'taken', medicationName: '降糖藥' },
  },

  /* ---------------- 覆診查詢 ---------------- */
  {
    id: 'appt-next',
    input: '下次覆診係幾時？',
    intents: ['appointment_query'],
    riskLevel: 'normal',
    actionsContains: ['query_history'],
  },
  {
    id: 'appt-hospital',
    input: '我下個禮拜要唔要返醫院覆診？',
    intents: ['appointment_query'],
    riskLevel: 'normal',
  },
  {
    id: 'appt-written',
    input: '請問我的複診預約是哪一天？',
    intents: ['appointment_query'],
    riskLevel: 'normal',
  },

  /* ---------------- 政策查詢（津貼／交通／醫療券） ---------------- */
  {
    id: 'policy-allowance',
    input: '65歲以上長者有咩津貼可以攞？',
    intents: ['policy_query'],
    riskLevel: 'normal',
    actionsContains: ['kb_search'],
  },
  {
    id: 'policy-voucher',
    input: '醫療券點樣用呀？',
    intents: ['policy_query'],
    riskLevel: 'normal',
    actionsContains: ['kb_search'],
  },
  {
    id: 'policy-transport',
    input: '交通補貼點樣申請？',
    intents: ['policy_query'],
    riskLevel: 'normal',
  },
  {
    id: 'policy-elderly-card',
    input: '長者咭有咩優惠？',
    intents: ['policy_query'],
    riskLevel: 'normal',
  },

  /* ---------------- 服務查詢（附近醫院／醫療資源） ---------------- */
  {
    id: 'service-nearby-hospital',
    input: '附近有咩醫院？',
    intents: ['medical_resource_query'],
    riskLevel: 'normal',
    actionsContains: ['kb_search'],
  },
  {
    id: 'service-health-centre',
    input: '邊間健康中心近啲？',
    intents: ['medical_resource_query'],
    riskLevel: 'normal',
  },

  /* ---------------- 家屬 ---------------- */
  {
    id: 'family-daughter-know',
    input: '我個女知唔知我今日去咗公園？',
    intents: ['family_contact', 'family_status_query'],
    riskLevel: 'normal',
  },
  {
    id: 'family-son-news',
    input: '我個仔有冇消息呀？',
    intents: ['family_status_query'],
    riskLevel: 'normal',
  },
  {
    id: 'family-wife-call',
    input: '幫我打電話俾我太太',
    intents: ['family_contact'],
    riskLevel: 'normal',
    actionsContains: ['notify_family'],
  },
  {
    id: 'family-grandson-call',
    input: '打俾我孫仔傾吓偈',
    intents: ['family_contact'],
    riskLevel: 'normal',
  },

  /* ---------------- 健康史（最近血壓／血糖） ---------------- */
  {
    id: 'history-bp',
    input: '我嘅血壓記錄最近點呀？',
    intents: ['health_history', 'general_health_question'],
    riskLevel: 'normal',
  },
  {
    id: 'history-glucose',
    input: '我嘅血糖記錄係幾多？',
    intents: ['health_history', 'general_health_question'],
    riskLevel: 'normal',
  },

  /* ---------------- wellbeing／未預寫自由句 ---------------- */
  {
    id: 'wellbeing-sleep-tired',
    input: '尋晚瞓唔好，今日冇精神',
    intents: ['symptom'],
    riskLevel: 'normal',
    expectExtracted: { symptomsContains: ['失眠', '疲勞'] },
  },
  {
    id: 'wellbeing-mood',
    input: '今日心情唔太好，唔想做嘢',
    intents: ['unknown'],
    riskLevel: 'normal',
    actionsContains: ['save_wellbeing_note'],
  },
  {
    id: 'wellbeing-morning-tea',
    input: '今朝同老友記飲咗茶，好開心',
    intents: ['unknown'],
    riskLevel: 'normal',
    actionsContains: ['save_wellbeing_note'],
  },
  {
    id: 'symptom-dizzy-nausea',
    input: '有少少頭暈，仲有啲想嘔',
    intents: ['symptom'],
    riskLevel: 'normal',
    expectExtracted: { symptomsContains: ['頭暈', '嘔吐'] },
  },

  /* ---------------- 高風險句：必須 riskLevel='urgent' ---------------- */
  {
    id: 'urgent-chest-pain-split',
    input: '我胸口突然好痛',
    intents: ['emergency'],
    highRisk: true,
    actionsContains: ['notify_family', 'emergency_call'],
  },
  {
    id: 'urgent-breathless',
    input: '透唔到氣，好辛苦呀',
    intents: ['emergency'],
    highRisk: true,
  },
  {
    id: 'urgent-fainted',
    input: '我今朝起身暈咗',
    intents: ['emergency'],
    highRisk: true,
  },
  {
    id: 'urgent-chest-tight',
    input: '胸悶悶咁，呼吸唔係好順',
    intents: ['emergency'],
    highRisk: true,
  },
]

/**
 * 13 類 intent 分類器：正則 + 關鍵詞加權評分。
 * 同一意思嘅唔同講法（書面語／口語／粵語）會得到相同 intent；
 * 無法判斷時回傳 'unknown'（上層引擎仍會給出合理回應，唔會報錯）。
 */
import type { Intent } from '../../types/ai'
import { screenHighRiskTerms } from './safetyScreen'
import { extractAll, type ExtractionResult } from './extraction'

interface Rule {
  pattern: RegExp
  weight: number
}

/** 家人稱謂（粵語 + 書面語） */
const FAMILY_PATTERN =
  /個仔|仔|兒子|儿子|個女|女兒|女儿|仔女|孫仔|孫女|孫|孙子|家人|太太|老公|丈夫|妻子|老伴/

/** 疑問／查詢語氣 */
const QUESTION_PATTERN =
  /幾時|幾號|幾點|邊日|邊度|邊間|點解|點樣|係咪|係點|可唔可以|要唔要|有冇|幾多|乜嘢|咩嘢|應該|點算|什麼時候|哪天|哪裡|怎么|為什麼|如何|是否|有沒有|多少/

/** 健康相關話題詞（general_health_question 用） */
const HEALTH_TOPIC_PATTERN =
  /血壓|血糖|膽固醇|血压|食藥|服藥|服药|吃藥|瞓覺|睡眠|瞓得|失眠|飲食|饮食|運動|运动|健康|養生|养生|營養|营养|維他命|維生素|飲[^，。？！\s]{0,6}水|食嘢|保養/

const INTENT_RULES: Record<Exclude<Intent, 'unknown'>, Rule[]> = {
  emergency: [
    { pattern: /救命|救護車|白車|999|快啲[嚟幫救]|即刻救|頂唔順|快[嚟來]救/, weight: 10 },
  ],
  symptom: [
    { pattern: /唔舒服|不舒服|好辛苦|周身唔舒服|覺得唔妥/, weight: 3 },
  ],
  vital_record: [
    { pattern: /記低|記錄低|記一記|記錄返|记录一下|帮我记|記錄低先/, weight: 2 },
  ],
  medication_taken: [],
  medication_missed: [],
  appointment_query: [
    { pattern: /覆[診诊]|复诊/, weight: 4 },
    { pattern: /預約|約咗|约了|预约|約好/, weight: 2 },
    { pattern: /睇醫生|睇医生|看医生|睇專科/, weight: 2 },
  ],
  health_history: [
    { pattern: /病[歷歴]|病例/, weight: 3 },
    { pattern: /紀[錄录]|记[錄录]|记录|記錄|歴史|歷史|历史/, weight: 3 },
    { pattern: /以前[嘅的]|過往|过去/, weight: 2 },
    { pattern: /查[吓一查]|睇[吓返]|想知道/, weight: 1 },
  ],
  policy_query: [
    {
      pattern:
        /醫療券|醫療咭|長者咭|長者卡|长者卡|津貼|津贴|補貼|补贴|社會保障|社保|退休金|生果金|傷殘津貼|福利|政策|資助|资助|綜援|综援/,
      weight: 5,
    },
  ],
  medical_resource_query: [
    { pattern: /診所|醫院|医院|健康中心|社區中心|社区中心|醫療資源|医疗资源/, weight: 3 },
    { pattern: /輪候|附近|邊度[有睇]|邊間|哪裡有|哪里有|有咩服務/, weight: 3 },
  ],
  family_contact: [
    { pattern: FAMILY_PATTERN, weight: 2 },
    { pattern: /打電話|打俾|打給|致電|致电|聯絡|联系|通知|打[過个]去|call[佢他她]/i, weight: 4 },
  ],
  family_status_query: [
    { pattern: FAMILY_PATTERN, weight: 2 },
    { pattern: /幾時返|返[嚟未]|喺邊|在哪|有冇消息|有没有消息|近況|近况|幾時到|平安|音訊|音讯/, weight: 3 },
  ],
  general_health_question: [],
}

/** 同分時嘅優先次序（越前越優先） */
const PRIORITY: readonly Intent[] = [
  'emergency',
  'vital_record',
  'symptom',
  'medication_missed',
  'medication_taken',
  'appointment_query',
  'health_history',
  'family_contact',
  'family_status_query',
  'policy_query',
  'medical_resource_query',
  'general_health_question',
  'unknown',
]

export interface IntentSignals {
  /** 上游 safetyScreen 已經觸發（唔傳就即場計算） */
  safetyTriggered?: boolean
  /** 上游已做嘅結構化抽取（唔傳就即場計算） */
  extraction?: ExtractionResult
}

/**
 * 分類 intent。純函數：同樣輸入必然得到同樣輸出。
 */
export function classifyIntent(text: string, signals: IntentSignals = {}): Intent {
  const normalized = (text ?? '').trim()
  if (!normalized) return 'unknown'

  // 緊急詞觸發安全篩查 → 一律 emergency
  const safetyTriggered = signals.safetyTriggered ?? screenHighRiskTerms(normalized).triggered
  if (safetyTriggered) return 'emergency'

  const extraction = signals.extraction ?? extractAll(normalized)
  const scores = new Map<Intent, number>()

  const add = (intent: Intent, weight: number) => {
    scores.set(intent, (scores.get(intent) ?? 0) + weight)
  }

  // 結構化抽取信號
  let vitalCount = 0
  if (extraction.bloodPressure) vitalCount += 1
  if (extraction.bloodGlucose !== undefined) vitalCount += 1
  if (extraction.heartRate !== undefined) vitalCount += 1
  if (extraction.weight !== undefined) vitalCount += 1
  if (vitalCount > 0) add('vital_record', Math.min(vitalCount * 3, 6))

  if (extraction.symptoms.length > 0) add('symptom', Math.min(extraction.symptoms.length * 3, 6))

  if (extraction.medicationStatus === 'taken' && hasMedicationMention(normalized)) {
    add('medication_taken', 5)
  }
  if ((extraction.medicationStatus === 'missed' || extraction.medicationStatus === 'late') && hasMedicationMention(normalized)) {
    add('medication_missed', 5)
  }

  // 關鍵詞評分
  for (const [intent, rules] of Object.entries(INTENT_RULES)) {
    for (const rule of rules) {
      if (rule.pattern.test(normalized)) {
        add(intent as Intent, rule.weight)
      }
    }
  }

  // appointment 類問題加上疑問語氣再加分
  const isQuestion = QUESTION_PATTERN.test(normalized)
  if (isQuestion && (scores.get('appointment_query') ?? 0) > 0) {
    add('appointment_query', 1)
  }

  // 健康紀錄查詢帶疑問語氣再加分（例：「我嘅血壓記錄係點？」）
  if (isQuestion && (scores.get('health_history') ?? 0) > 0) {
    add('health_history', 2)
  }

  // general_health_question：必須有健康話題詞先計，避免任意問句誤判
  if (HEALTH_TOPIC_PATTERN.test(normalized)) {
    add('general_health_question', 3)
    if (isQuestion) add('general_health_question', 2)
  }

  // 揀最高分；同分跟優先次序；完全冇信號 → unknown
  let best: Intent = 'unknown'
  let bestScore = 0
  for (const intent of PRIORITY) {
    const score = scores.get(intent) ?? 0
    if (score > bestScore) {
      best = intent
      bestScore = score
    }
  }
  return bestScore >= 2 ? best : 'unknown'
}

function hasMedicationMention(text: string): boolean {
  return /藥|药/.test(text)
}

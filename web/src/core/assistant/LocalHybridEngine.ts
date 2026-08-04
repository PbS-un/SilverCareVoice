/**
 * Local Hybrid Engine —— 無 API Key 時嘅完整可用 AI 後備。
 *
 * 流程（全部純函數、可測試、可離線）：
 * 1. safetyScreen —— 高風險詞即時攔截（必須喺任何「LLM」之前）
 * 2. extraction —— 結構化抽取（血壓／血糖／症狀／藥物／時間詞）
 * 3. intent —— 13 類 intent 加權評分分類
 * 4. 模板組裝 —— 粵語、1–2 句、長者友善回覆 + 風險評估 + 行動標記
 *
 * 任意自由輸入都會得到合理回應；actions 只係標記，
 * 實際數據查詢／kb 搜尋／通知家人由 AssistantService 執行。
 */
import type { AssistantAction, ExtractedData, Intent, RiskLevel, StructuredAnalysis } from '../../types/ai'
import { screenHighRiskTerms } from './safetyScreen'
import { extractAll, type ExtractionResult } from './extraction'
import { classifyIntent } from './intent'

export interface AssistantContext {
  /** 長者稱呼（可選） */
  userName?: string
  [key: string]: unknown
}

/* ------------------------------ 風險評估 ------------------------------ */

const BP_ATTENTION_SYSTOLIC = 140
const BP_ATTENTION_DIASTOLIC = 90
const BP_URGENT_SYSTOLIC = 180
const BP_URGENT_DIASTOLIC = 110

function isBpHigh(bp: { systolic: number; diastolic: number }): boolean {
  return bp.systolic >= BP_ATTENTION_SYSTOLIC || bp.diastolic >= BP_ATTENTION_DIASTOLIC
}

function isBpSevere(bp: { systolic: number; diastolic: number }): boolean {
  return bp.systolic >= BP_URGENT_SYSTOLIC || bp.diastolic >= BP_URGENT_DIASTOLIC
}

function assessRisk(safetyTriggered: boolean, extraction: ExtractionResult): RiskLevel {
  if (safetyTriggered) return 'urgent'

  const bp = extraction.bloodPressure
  if (bp && isBpSevere(bp)) return 'urgent'
  if (bp && isBpHigh(bp)) return 'attention'

  if (extraction.bloodGlucose !== undefined && (extraction.bloodGlucose < 3.9 || extraction.bloodGlucose > 13.9)) {
    return 'attention'
  }
  if (extraction.heartRate !== undefined && (extraction.heartRate > 120 || extraction.heartRate < 45)) {
    return 'attention'
  }
  if (extraction.symptoms.length >= 3) return 'attention'
  return 'normal'
}

/* ------------------------------ 主題／家人詞抽取 ------------------------------ */

const TOPIC_KEYWORDS: readonly string[] = [
  '醫療券', '醫療咭', '長者咭', '長者卡', '津貼', '補貼', '社保', '社會保障',
  '退休金', '生果金', '傷殘津貼', '綜援', '政策', '資助', '福利',
  '診所', '醫院', '社區中心', '健康中心', '醫療資源', '輪候',
  '覆診', '預約', '病歷', '紀錄',
  '睡眠', '瞓覺', '血壓', '血糖', '膽固醇', '飲食', '運動', '營養', '食藥', '飲水',
]

function pickQueryTopic(text: string): string {
  for (const keyword of TOPIC_KEYWORDS) {
    if (text.includes(keyword)) return keyword
  }
  return text.replace(/[？?！!。，,\s]/g, '').slice(0, 12) || '未知主題'
}

const FAMILY_TERMS: readonly string[] = [
  '個仔', '兒子', '個女', '女兒', '孫仔', '孫女', '孫',
  '太太', '老公', '丈夫', '妻子', '老伴', '仔', '女', '家人',
]

function pickFamilyMember(text: string): string {
  for (const term of FAMILY_TERMS) {
    if (text.includes(term)) return term
  }
  return '家人'
}

/* ------------------------------ 回覆模板 ------------------------------ */

/** 症狀 → 長者友善建議 */
const SYMPTOM_ADVICE: Record<string, string> = {
  頭暈: '坐低休息吓，起身嗰陣慢啲呀。',
  頭痛: '休息吓，飲啲水先。',
  發燒: '飲多啲水，如果一直發燒要睇醫生呀。',
  嘔吐: '慢慢飲少少暖水，嘔得厲害要睇醫生呀。',
  肚瀉: '飲多啲水補充水分，肚瀉唔止要睇醫生呀。',
  肚痛: '如果痛得厲害要睇醫生呀。',
  胃痛: '食清淡啲，痛得耐要睇醫生呀。',
  口渴: '飲啲水先，如果成日口渴要留意血糖呀。',
  眼矇: '休息吓對眼先，睇嘢模糊要睇醫生呀。',
  腳腫: '坐低抬吓腳先，腫得耐要睇醫生呀。',
  疲勞: '休息吓先，唔好太操勞呀。',
  失眠: '睡前放鬆吓，少飲茶先。',
  心悸: '坐低休息吓，成日心悒要睇醫生呀。',
  咳嗽: '飲啲暖水先，咳得耐要睇醫生呀。',
  麻痺: '手腳麻痹要留意，持續嘅話要睇醫生呀。',
  氣促: '坐低慢慢唞氣先，持續氣促要睇醫生呀。',
}

function buildExtractedData(intent: Intent, extraction: ExtractionResult, text: string): ExtractedData | undefined {
  const data: ExtractedData = {}

  if (extraction.bloodPressure) data.bloodPressure = extraction.bloodPressure
  if (extraction.bloodGlucose !== undefined) data.bloodGlucose = extraction.bloodGlucose
  if (extraction.heartRate !== undefined) data.heartRate = extraction.heartRate
  if (extraction.weight !== undefined) data.weight = extraction.weight
  if (extraction.symptoms.length > 0) data.symptoms = extraction.symptoms
  if (extraction.medicationName) data.medicationName = extraction.medicationName
  if (extraction.medicationStatus) data.medicationStatus = extraction.medicationStatus

  if (intent === 'appointment_query') {
    data.appointment = extraction.timeHints.length > 0 ? { note: extraction.timeHints.join('、') } : {}
    data.queryTopic = pickQueryTopic(text)
  }
  if (intent === 'policy_query' || intent === 'medical_resource_query' || intent === 'general_health_question' || intent === 'health_history') {
    data.queryTopic = pickQueryTopic(text)
  }

  return Object.keys(data).length > 0 ? data : undefined
}

function buildVitalRecordAnswer(extraction: ExtractionResult): { answer: string; detailedAnswer?: string } {
  const parts: string[] = []
  const bp = extraction.bloodPressure

  if (bp) {
    if (isBpSevere(bp)) {
      parts.push(`你血壓 ${bp.systolic}/${bp.diastolic} 幾高喎，即刻坐低休息先。`)
      parts.push('如果仲覺得唔舒服，記得叫家人幫手或者睇醫生呀。')
      return { answer: parts.join(''), detailedAnswer: '收縮壓 ≥180 或舒張壓 ≥110 屬偏高，建議稍後再量度並留意身體狀況。' }
    }
    parts.push(`收到，你而家血壓 ${bp.systolic}/${bp.diastolic}，我幫你記低咗。`)
    if (isBpHigh(bp)) {
      parts.push('休息吓，遲啲再量多次啦。')
    }
    if (extraction.symptoms.includes('頭暈')) {
      parts.push('你有啲頭暈，起身慢啲、坐穩先呀。')
    }
    return { answer: parts.join('') }
  }

  if (extraction.bloodGlucose !== undefined) {
    parts.push(`收到，你血糖 ${extraction.bloodGlucose}，我幫你記低咗。`)
    if (extraction.bloodGlucose < 3.9) {
      parts.push('有啲低喎，食少少嘢先，唔好暈親呀。')
    } else if (extraction.bloodGlucose > 13.9) {
      parts.push('有啲高喎，飲多啲水，留意吓呀。')
    }
    return { answer: parts.join('') }
  }

  if (extraction.heartRate !== undefined) {
    parts.push(`收到，你心跳每分鐘 ${extraction.heartRate} 下，我幫你記低咗。`)
    if (extraction.heartRate > 120 || extraction.heartRate < 45) {
      parts.push('如果覺得心悒或者唔舒服，記得話我知呀。')
    }
    return { answer: parts.join('') }
  }

  if (extraction.weight !== undefined) {
    return { answer: `收到，你體重 ${extraction.weight} 公斤，我幫你記低咗。` }
  }

  return { answer: '收到，我幫你記低咗。' }
}

function buildSymptomAnswer(extraction: ExtractionResult): { answer: string; detailedAnswer?: string } {
  const symptoms = extraction.symptoms
  if (symptoms.length === 0) {
    return { answer: '聽到你有啲唔舒服，我幫你記低咗。如果持續唔舒服，記得話我知或者睇醫生呀。' }
  }

  const symptomList = symptoms.slice(0, 3).join('、')
  const advice = SYMPTOM_ADVICE[symptoms[0]] ?? '如果持續唔舒服，記得話我知或者睇醫生呀。'
  const answer = `聽到你有啲唔舒服，${symptomList}要留意吓㗎。${advice}`

  let detailedAnswer: string | undefined
  if (extraction.symptoms.includes('頭暈') && extraction.bloodPressure && isBpHigh(extraction.bloodPressure)) {
    detailedAnswer = `頭暈加上血壓偏高（${extraction.bloodPressure.systolic}/${extraction.bloodPressure.diastolic}），建議休息並稍後再量度血壓。`
  }
  return { answer, detailedAnswer }
}

/* ------------------------------ 引擎主體 ------------------------------ */

export class LocalHybridEngine {
  /**
   * 分析一句自由輸入，回傳結構化結果。
   * 純函數式流程：同樣輸入必然得到同樣輸出。
   */
  analyze(text: string, _context: AssistantContext = {}): StructuredAnalysis {
    const normalized = (text ?? '').trim()

    // 1. 安全篩查（先於一切分析）
    const safety = screenHighRiskTerms(normalized)

    // 2. 結構化抽取
    const extraction = extractAll(normalized)

    // 3. intent 分類（空輸入都唔會報錯）
    const intent: Intent = normalized ? classifyIntent(normalized, { safetyTriggered: safety.triggered, extraction }) : 'unknown'

    // 4. 風險評估（emergency intent 一律 urgent）
    const riskLevel: RiskLevel =
      safety.triggered || intent === 'emergency' ? 'urgent' : assessRisk(safety.triggered, extraction)

    // 5. 組裝回覆
    let answer = ''
    let detailedAnswer: string | undefined
    let actions: AssistantAction[] | undefined

    if (safety.triggered) {
      const term = safety.matchedTerms[0]
      answer = `${term}要小心，建議即刻聯絡家人或者搵醫療協助。`
      detailedAnswer = '檢測到高風險徵狀，已標記為緊急情況。'
      actions = [
        { type: 'notify_family', label: '通知家人' },
        { type: 'emergency_call', label: '緊急求助' },
      ]
    } else {
      switch (intent) {
        case 'emergency':
          answer = '我聽到你好唔舒服，而家幫你搵緊急協助，請保持冷靜、坐低休息先。'
          detailedAnswer = '長者主動求助，已標記為緊急情況。'
          actions = [
            { type: 'notify_family', label: '通知家人' },
            { type: 'emergency_call', label: '緊急求助' },
          ]
          break

        case 'vital_record': {
          const built = buildVitalRecordAnswer(extraction)
          answer = built.answer
          detailedAnswer = built.detailedAnswer
          break
        }

        case 'symptom': {
          const built = buildSymptomAnswer(extraction)
          answer = built.answer
          detailedAnswer = built.detailedAnswer
          break
        }

        case 'medication_taken':
          answer = extraction.medicationName
            ? `好嘅，你食咗${extraction.medicationName}，我幫你記低咗。`
            : '好嘅，你食咗藥，我幫你記低咗。'
          break

        case 'medication_missed': {
          const name = extraction.medicationName ?? '藥'
          answer =
            extraction.medicationStatus === 'late'
              ? `收到，你遲咗食${name}，我幫你記低咗，之後記得按時食呀。`
              : `唔緊要，漏咗食${name}我幫你記低咗。記得之後按時食藥呀。`
          detailedAnswer = '如有疑問應否補服藥物，請諮詢醫生意見。'
          break
        }

        case 'appointment_query':
          answer = '我幫你查吓你嘅覆診預約先。'
          actions = [{ type: 'query_history', label: '查詢覆診預約' }]
          break

        case 'health_history':
          answer = '我幫你搵吓你嘅健康紀錄先。'
          actions = [{ type: 'query_history', label: '查詢健康紀錄' }]
          break

        case 'policy_query':
          answer = '我幫你搵吓相關資訊先。'
          actions = [{ type: 'kb_search', label: '查詢政策資訊' }]
          break

        case 'medical_resource_query':
          answer = '我幫你搵吓相關資訊先。'
          actions = [{ type: 'kb_search', label: '查詢醫療資源' }]
          break

        case 'family_contact': {
          const who = pickFamilyMember(normalized)
          answer = `好嘅，我幫你聯絡${who}先。`
          actions = [{ type: 'notify_family', label: '聯絡家人' }]
          break
        }

        case 'family_status_query': {
          const who = pickFamilyMember(normalized)
          answer = `我幫你睇吓${who}嘅近況先。`
          actions = [{ type: 'query_family_status', label: '查詢家人近況' }]
          break
        }

        case 'general_health_question':
          answer = '你呢個問題好好，我幫你搵吓相關資訊先。'
          detailedAnswer = `問題主題：${pickQueryTopic(normalized)}`
          actions = [{ type: 'kb_search', label: '查詢健康資訊' }]
          break

        case 'unknown':
        default:
          // 溫和兜底：原文存為 wellbeing note，絕不說「只支援預設問題」
          answer = '我明白你嘅情況，已經幫你記低。如果有唔舒服記得話我知。'
          detailedAnswer = normalized || undefined
          actions = [{ type: 'save_wellbeing_note', label: '記低近況' }]
          break
      }
    }

    const extractedData = buildExtractedData(intent, extraction, normalized)

    return {
      intent: safety.triggered ? 'emergency' : intent,
      riskLevel,
      answer,
      ...(detailedAnswer ? { detailedAnswer } : {}),
      ...(extractedData ? { extractedData } : {}),
      ...(actions ? { actions } : {}),
    }
  }
}

/** 預設單例，方便直接 import 使用 */
export const localHybridEngine = new LocalHybridEngine()

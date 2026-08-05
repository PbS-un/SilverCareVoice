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
  '阿仔', '阿女', '阿孫', '屋企人', '監護人', '照顧者',
  '個仔', '兒子', '個女', '女兒', '孫仔', '孫女', '孫',
  '太太', '老公', '丈夫', '妻子', '老伴', '仔', '女', '家人',
]

function pickFamilyMember(text: string): string {
  for (const term of FAMILY_TERMS) {
    if (text.includes(term)) return term
  }
  return '家人'
}

/** 覆診語句嘅疑問語氣偵測（record／query 方向分岔用） */
const APPT_QUESTION_PATTERN = /幾時|幾號|幾點|邊日|要唔要|係咪|可唔可以|有冇|？|\?|吗|嗎/

/** ISO date → 粵語口語日期（例：2026-08-12 → 8月12日（星期三）） */
function formatChineseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${Number(m[2])}月${Number(m[3])}日（星期${weekday}）`
}

/**
 * 藥物多候選問句佔位符：
 * 當用戶只講「食咗藥」而 DB 有多種候選藥物時，候選列表由 AssistantService
 * 查庫後構造問句（執行門控，後續任務）。引擎層保持純函數，用佔位預留結構。
 */
export const MEDICATION_CANDIDATES_PLACEHOLDER = '{{medicationCandidates}}'

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
  if (extraction.medicationDoseAmount !== undefined) data.medicationDoseAmount = extraction.medicationDoseAmount
  if (extraction.medicationDoseUnit !== undefined) data.medicationDoseUnit = extraction.medicationDoseUnit

  if (intent === 'appointment_query') {
    const appt = extraction.appointment
    if (appt) {
      data.appointment = {
        ...(appt.date ? { date: appt.date } : {}),
        ...(appt.time ? { time: appt.time } : {}),
        ...(appt.location ? { location: appt.location } : {}),
        ...(appt.department ? { department: appt.department } : {}),
        ...(appt.doctor ? { doctor: appt.doctor } : {}),
        // 未解析到具體日期時，用時間詞提示做 note 補充
        ...(!appt.date && extraction.timeHints.length > 0 ? { note: extraction.timeHints.join('、') } : {}),
      }
    } else {
      data.appointment = extraction.timeHints.length > 0 ? { note: extraction.timeHints.join('、') } : {}
    }
    data.queryTopic = pickQueryTopic(text)
  }
  if (intent === 'policy_query' || intent === 'medical_resource_query' || intent === 'general_health_question' || intent === 'health_history') {
    data.queryTopic = pickQueryTopic(text)
  }

  return Object.keys(data).length > 0 ? data : undefined
}

/** 講到血壓相關詞但未能抽取完整數值（追問用，絕不聲稱已記錄或可代量） */
const BP_MENTION_PATTERN = /血壓|血圧|上壓|下壓|高壓|低壓|收縮壓|舒張壓/

function buildVitalRecordAnswer(extraction: ExtractionResult, text: string): { answer: string; detailedAnswer?: string } {
  const parts: string[] = []
  const bp = extraction.bloodPressure

  // 血壓不完整：提到血壓但冇完整數值（例：「我要記血壓」／只講咗一個數）
  // → 追問上壓同下壓，唔講「已記低」
  if (!bp && BP_MENTION_PATTERN.test(text)) {
    return { answer: '好呀，你上壓同下壓係幾多？你話我知兩個數，我即刻幫你記。' }
  }

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
          const built = buildVitalRecordAnswer(extraction, normalized)
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

        case 'medication_taken': {
          // 劑量有抽到就一併覆述（例：「食咗降壓藥半粒」）
          const doseStr =
            extraction.medicationDoseAmount !== undefined
              ? `${extraction.medicationDoseAmount}${extraction.medicationDoseUnit ?? ''}`
              : ''
          if (extraction.medicationName) {
            answer = `好嘅，你食咗${extraction.medicationName}${doseStr}，我幫你記低咗。`
          } else {
            // 冇明確藥名（可能有多候選）：實際候選列表由 AssistantService 查庫後
            // 構造問句（執行門控，後續任務）；引擎層用佔位符預留問句結構。
            answer = `好嘅，你食咗藥。你食嘅係邊一種呀？${MEDICATION_CANDIDATES_PLACEHOLDER}`
          }
          break
        }

        case 'medication_missed': {
          const name = extraction.medicationName ?? '藥'
          answer =
            extraction.medicationStatus === 'late'
              ? `收到，你遲咗食${name}，我幫你記低咗，之後記得按時食呀。`
              : `唔緊要，漏咗食${name}我幫你記低咗。記得之後按時食藥呀。`
          detailedAnswer = '如有疑問應否補服藥物，請諮詢醫生意見。'
          break
        }

        case 'appointment_query': {
          const appt = extraction.appointment
          // 記錄方向：抽到日期／時間 + 非疑問句 → 確認句式「幫你記低…啱唔啱？」
          // （實際寫入由後續執行門控任務處理，呢度只係確認問句）
          if (appt && (appt.date || appt.time) && !APPT_QUESTION_PATTERN.test(normalized)) {
            const parts: string[] = []
            if (appt.date) parts.push(formatChineseDate(appt.date))
            if (appt.time) parts.push(appt.time)
            if (appt.location) parts.push(`去${appt.location}`)
            if (appt.department) parts.push(`睇${appt.department}`)
            if (appt.doctor) parts.push(`搵${appt.doctor}醫生`)
            answer = `好嘅，幫你記低${parts.join('，')}覆診，啱唔啱呀？`
            actions = [{ type: 'confirm_record', label: '確認覆診記錄' }]
          } else {
            answer = '我幫你查吓你嘅覆診預約先。'
            actions = [{ type: 'query_history', label: '查詢覆診預約' }]
          }
          break
        }

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

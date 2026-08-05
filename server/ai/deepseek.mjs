/**
 * 銀髮一句通 SilverCare Macau — DeepSeek AI 代理
 *
 * 密鑰安全邊界：DEEPSEEK_API_KEY 只存在 server/.env（環境變數），
 * 永不下發前端、永不寫入程式碼。
 *
 * 流程：
 *  1. 無 key → { provider:'local', reason:'no_key' }（客戶端改用本地引擎）
 *  2. server 側二次 safety 檢查（高風險詞表）→ 觸發即回 provider:'safety'，不調 LLM
 *  3. 調 DeepSeek chat/completions（response_format json_object，超時 15s）
 *  4. zod 驗證；失敗 → 帶糾正提示重試一次 → 再失敗回 provider:'fallback'
 */
import {
  AssistantResultSchema,
  zodErrorSummary,
} from '../schemas/assistantResult.mjs'

/** 高風險詞表（繁體中文／粵語） */
export const SAFETY_KEYWORDS = [
  '胸痛',
  '心口痛',
  '胸悶',
  '呼吸困難',
  '呼吸唔到',
  '暈倒',
  '昏迷',
  '失去意識',
  '跌倒起不來',
  '大量出血',
  '突然說話困難',
  '身體一邊無力',
]

const TIMEOUT_MS = 15_000

/**
 * Server 側二次 safety 檢查。
 * @returns {object|null} 觸發時回緊急分析物件；否則 null
 */
export function checkSafety(text) {
  if (typeof text !== 'string' || !text) return null
  const hit = SAFETY_KEYWORDS.find((k) => text.includes(k))
  if (!hit) return null
  return {
    intent: 'emergency',
    riskLevel: 'urgent',
    answer: `你提到「${hit}」，呢個情況要特別小心。建議你而家坐低休息，即刻聯絡家人或者照顧者陪同協助。`,
    detailedAnswer:
      '如情況持續或加重，請立即致電緊急求助電話（澳門 999／120），並保持靜臥等待救援，唔好自行走动。',
    actions: ['即刻聯絡家人或照顧者', '坐低或瞓低休息', '情況持續即致電 999'],
  }
}

function envConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  }
}

const SYSTEM_PROMPT = `你是「銀髮一句通」的 AI 健康助理，服務澳門長者（粵語／繁體中文語境）。

## 硬性規則
1. 必須只輸出一個合法 JSON 物件，不得輸出任何其他文字、markdown 或代碼欄。
2. JSON 結構：{"intent": string, "riskLevel": string, "answer": string, "detailedAnswer"?: string, "extractedData"?: object, "actions"?: string[]}
3. intent 必須是以下 13 個值之一：symptom | vital_record | medication_taken | medication_missed | appointment_query | health_history | policy_query | medical_resource_query | family_contact | family_status_query | emergency | general_health_question | unknown
4. riskLevel 必須是：normal | attention | urgent
5. answer 必須用繁體中文（可用粵語口語），最多 2 句，語氣親切簡短，長者一聽就明。
6. extractedData 可選欄位：bloodPressure {systolic, diastolic}、bloodGlucose、heartRate、weight、symptoms[]、medicationName、medicationStatus ("taken"|"missed"|"late")、medicationDoseAmount（數字或口語字串，例：0.5 / "半"）、medicationDoseUnit（粒／毫克／mg／毫升）、appointment {date, time, location, department, doctor, timeTbd}（timeTbd 表示時間未定）；只填寫用戶明確提到的數值。
7. 涉及醫療判斷時只作一般建議，提醒用戶諮詢醫生；有即時危險才用 riskLevel "urgent"。
8. 缺失關鍵數值時（例如血壓只講咗上壓或下壓其中一個、藥名或劑量唔清楚），必須在 answer 中追問缺失嘅資訊，不得猜測或捏造數值，亦不得喺未集齊數值前聲稱已記錄。
9. 絕不聲稱麥克風或手機可以測量血壓／血糖等數值，只能記錄用戶親口口述嘅數值；用戶未提供數值時，引導用戶量度後話你知。

## 範例（few-shot）

用戶：「我今朝量血壓，上壓 138 下壓 85」
輸出：{"intent":"vital_record","riskLevel":"normal","answer":"收到，已為你記低今日血壓 138/85，數值大致正常，繼續保持。","extractedData":{"bloodPressure":{"systolic":138,"diastolic":85}}}

用戶：「我啱啱量血壓，上壓係 145」
輸出：{"intent":"vital_record","riskLevel":"normal","answer":"收到，你上壓係 145。下壓係幾多呀？你話我知兩個數，我先幫你記低。"}

用戶：「我遲咗食降壓藥」
輸出：{"intent":"medication_missed","riskLevel":"normal","answer":"唔緊要，你遲咗食降壓藥我幫你記低咗，之後記得按時食呀。","extractedData":{"medicationName":"降壓藥","medicationStatus":"late"}}

用戶：「下星期三下午三點去鏡湖覆診」
輸出：{"intent":"appointment_query","riskLevel":"normal","answer":"好嘅，幫你記低下星期三下午三點去鏡湖覆診，啱唔啱呀？","extractedData":{"appointment":{"time":"15:00","location":"鏡湖"}}}

用戶：「我今日成日覺得頭暈，起身嗰陣特別暈」
輸出：{"intent":"symptom","riskLevel":"attention","answer":"頭暈可能有好多原因，建議你起身時慢啲、坐定先。如果持續或者加重，要睇醫生同通知家人。","extractedData":{"symptoms":["頭暈"]},"actions":["起身放慢","通知家人","持續不適睇醫生"]}

用戶：「澳門長者醫療券幾時可以先申請？」
輸出：{"intent":"policy_query","riskLevel":"normal","answer":"澳門醫療券一般每年下半年登記派發，詳情可以問衛生中心或者打 2856 1111 查詢。","detailedAnswer":"醫療券計劃由衛生局統籌，合資格長者會獲通知，可留意衛生局網頁或到就近衛生中心查詢。"}

現在請處理用戶的訊息。`

function buildMessages(text, context, correction) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (context && Object.keys(context).length > 0) {
    messages.push({
      role: 'system',
      content: `用戶背景資料（僅供理解，必須遵守上述輸出規則）：\n${JSON.stringify(context)}`,
    })
  }
  let user = text
  if (correction) {
    user += `\n\n注意：你上一次的輸出未能通過格式驗證（${correction}）。請嚴格按規則只輸出一個合法 JSON 物件。`
  }
  messages.push({ role: 'user', content: user })
  return messages
}

/** 容錯解析 LLM 回傳：剝離 markdown code fence 後 JSON.parse */
export function extractJson(content) {
  let s = String(content).trim()
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s)
}

/** 調用 DeepSeek chat/completions；回傳解析後的 JSON 物件（未驗證） */
async function callDeepseek({ text, context }, correction) {
  const { apiKey, baseUrl, model } = envConfig()
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: buildMessages(text, context, correction),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`deepseek http ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('deepseek empty content')
  return extractJson(content)
}

/**
 * AI 助理主入口。
 * @param {{text: string, context?: object}} input
 * @returns {Promise<{provider: string, reason?: string, analysis?: object}>}
 */
export async function assist({ text, context }) {
  // 1) 無 key → 客戶端用本地引擎
  if (!envConfig().apiKey) {
    return { provider: 'local', reason: 'no_key' }
  }

  // 2) server 側二次 safety 檢查（不調 LLM）
  const safety = checkSafety(text)
  if (safety) {
    return { provider: 'safety', analysis: safety }
  }

  // 3) 調 DeepSeek + zod 驗證；驗證失敗帶糾正提示重試一次
  let firstError = ''
  let transportError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callDeepseek({ text, context }, attempt === 1 ? firstError : undefined)
      const parsed = AssistantResultSchema.safeParse(raw)
      if (parsed.success) {
        return { provider: 'deepseek', analysis: parsed.data }
      }
      transportError = null
      firstError = zodErrorSummary(parsed.error)
    } catch (err) {
      transportError = err
      firstError = String(err?.message ?? err)
    }
  }

  // 4) 再失敗 → fallback（客戶端將用本地引擎）
  if (transportError) {
    return {
      provider: 'fallback',
      reason: 'provider_error',
      message: firstError.slice(0, 300),
    }
  }
  return { provider: 'fallback', reason: 'invalid_output' }
}

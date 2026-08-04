/**
 * AI 分析共用的類型與 zod schema。
 *
 * 呢個 schema 係 DeepSeek 結構化輸出嘅合約定義：
 * - 客戶端（LocalHybridEngine / AssistantService）用它驗證本地輸出
 * - server proxy 用它驗證 DeepSeek 回傳嘅 JSON
 */
import { z } from 'zod'

/** 規範書定義嘅 13 類 intent（名稱必須完全一致） */
export const INTENTS = [
  'symptom',
  'vital_record',
  'medication_taken',
  'medication_missed',
  'appointment_query',
  'health_history',
  'policy_query',
  'medical_resource_query',
  'family_contact',
  'family_status_query',
  'emergency',
  'general_health_question',
  'unknown',
] as const

export type Intent = (typeof INTENTS)[number]

/** 風險等級：normal 正常 / attention 需留意 / urgent 緊急 */
export type RiskLevel = 'normal' | 'attention' | 'urgent'

export const RISK_LEVELS = ['normal', 'attention', 'urgent'] as const

/** 由語音/文字抽取到嘅結構化數據 */
export const extractedDataSchema = z.object({
  bloodPressure: z
    .object({
      systolic: z.number(),
      diastolic: z.number(),
    })
    .optional(),
  bloodGlucose: z.number().optional(),
  heartRate: z.number().optional(),
  weight: z.number().optional(),
  symptoms: z.array(z.string()).optional(),
  medicationName: z.string().optional(),
  medicationStatus: z.enum(['taken', 'missed', 'late']).optional(),
  appointment: z
    .object({
      date: z.string().optional(),
      location: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
  queryTopic: z.string().optional(),
})

export type ExtractedData = z.infer<typeof extractedDataSchema>

/** 助手行動建議標記（實際執行由 AssistantService / UI 負責） */
export const actionSchema = z.object({
  type: z.string(),
  label: z.string(),
})

export type AssistantAction = z.infer<typeof actionSchema>

/** 一次完整分析嘅結構化輸出 */
export const structuredAnalysisSchema = z.object({
  intent: z.enum(INTENTS),
  riskLevel: z.enum(RISK_LEVELS),
  /** 1–2 句粵語回覆，長者友善 */
  answer: z.string().min(1),
  /** 可選：補充說明 */
  detailedAnswer: z.string().optional(),
  extractedData: extractedDataSchema.optional(),
  /** 標記俾上層執行嘅動作（查 DB、kb 搜尋、通知家人等） */
  actions: z.array(actionSchema).optional(),
  /** 資訊來源（kb 搜尋結果用） */
  sources: z.array(z.string()).optional(),
})

export type StructuredAnalysis = z.infer<typeof structuredAnalysisSchema>

/**
 * 驗證任意 JSON 係咪合法 StructuredAnalysis（DeepSeek / 本地引擎共用）。
 * 回傳 { success, data?, error? }，唔會拋出異常。
 */
export function parseStructuredAnalysis(input: unknown):
  | { success: true; data: StructuredAnalysis }
  | { success: false; error: string } {
  const result = structuredAnalysisSchema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}

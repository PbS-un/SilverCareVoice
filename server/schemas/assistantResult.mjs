/**
 * 銀髮一句通 SilverCare Macau — AI 助理輸出結果 zod schema
 *
 * 與 DeepSeek system prompt 規定的 JSON 契約一致：
 * { intent, riskLevel, answer, detailedAnswer?, extractedData?, actions? }
 *
 * 前端 DeepSeekClient 收到的 analysis 欄位即為此 schema 通過後的物件。
 */
import { z } from 'zod'

/** intent 限定 13 值 */
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
]

export const RISK_LEVELS = ['normal', 'attention', 'urgent']

/** 生命體徵 / 用藥抽取欄位（皆可選，允許 passthrough 擴展） */
export const ExtractedDataSchema = z
  .object({
    bloodPressure: z
      .object({
        systolic: z.number().int().positive().optional(),
        diastolic: z.number().int().positive().optional(),
      })
      .partial()
      .optional(),
    bloodGlucose: z.number().positive().optional(),
    heartRate: z.number().positive().optional(),
    weight: z.number().positive().optional(),
    symptoms: z.array(z.string()).optional(),
    medicationName: z.string().optional(),
    medicationStatus: z.enum(['taken', 'missed']).optional(),
  })
  .partial()
  .passthrough()

/** AI 助理分析結果 */
export const AssistantResultSchema = z.object({
  intent: z.enum(INTENTS),
  riskLevel: z.enum(RISK_LEVELS).default('normal'),
  answer: z.string().min(1),
  detailedAnswer: z.string().optional(),
  extractedData: ExtractedDataSchema.optional(),
  actions: z.array(z.string()).optional(),
})

/** POST /api/ai/chat 請求 body */
export const ChatRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  context: z.record(z.any()).optional(),
})

export function zodErrorSummary(error) {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

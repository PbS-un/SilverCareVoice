import { describe, expect, it } from 'vitest'
import { LocalHybridEngine, localHybridEngine } from '../LocalHybridEngine'
import { structuredAnalysisSchema } from '../../../types/ai'

const engine = new LocalHybridEngine()

/** 自由輸入樣本：覆蓋 13 類 intent + 兜底 */
const FREE_INPUTS = [
  '我今朝量到血壓155/92',
  '我心口痛呀',
  '我唔記得食降糖藥',
  '我食咗降壓藥',
  '我幾時覆診呀？',
  '我想睇吓我嘅病歷紀錄',
  '長者醫療券點樣用？',
  '附近邊間診所能夠睇眼科？',
  '幫我打電話俾我個仔',
  '我個女幾時返嚟？',
  '點樣先可以瞓得好啲？',
  '今日天氣唔錯',
  '我有啲頭暈',
  '我血糖3.2，有啲攰',
  '快啲嚟救我',
  '同你傾吓偈，今日去咗公園',
  // 新增：血壓追問／覆診確認／搵家人
  '我啱啱血壓138/82',
  '我要記血壓',
  '下星期三下午三點去鏡湖覆診',
  '搵我個仔',
  '',
]

describe('LocalHybridEngine — 任意自由輸入都有合理回應', () => {
  it('全部自由輸入都通過 StructuredAnalysis schema 驗證，且 answer 非空', () => {
    for (const input of FREE_INPUTS) {
      const result = engine.analyze(input)
      const parsed = structuredAnalysisSchema.safeParse(result)
      expect(parsed.success, `輸入「${input}」應通過 schema 驗證：${parsed.success ? '' : parsed.error.message}`).toBe(true)
      expect(result.answer.length, `輸入「${input}」應有非空回應`).toBeGreaterThan(0)
    }
  })

  it('絕唔會講「只支援預設問題」之類嘅拒絕語', () => {
    for (const input of FREE_INPUTS) {
      const { answer } = engine.analyze(input)
      expect(answer).not.toContain('只支援')
      expect(answer).not.toContain('無法理解')
      expect(answer).not.toContain('唔識別')
    }
  })

  it('血壓記錄：vital_record + 覆述數值', () => {
    const result = engine.analyze('我今朝量到血壓155/92')
    expect(result.intent).toBe('vital_record')
    expect(result.answer).toContain('155/92')
    expect(result.answer).toContain('記低')
    expect(result.extractedData?.bloodPressure).toEqual({ systolic: 155, diastolic: 92 })
    expect(result.riskLevel).toBe('attention')
  })

  it('血壓正常值：riskLevel=normal', () => {
    const result = engine.analyze('血壓120/78')
    expect(result.intent).toBe('vital_record')
    expect(result.riskLevel).toBe('normal')
  })

  it('血壓極高：riskLevel=urgent', () => {
    const result = engine.analyze('我血壓185/115')
    expect(result.intent).toBe('vital_record')
    expect(result.riskLevel).toBe('urgent')
  })

  it('頭暈 + 血壓高 → attention 並提醒', () => {
    const result = engine.analyze('我血壓155/92，有啲頭暈')
    expect(result.intent).toBe('vital_record')
    expect(result.riskLevel).toBe('attention')
    expect(result.answer).toContain('頭暈')
  })

  it('安全詞即時攔截：urgent + 通知家人／緊急求助', () => {
    const result = engine.analyze('我突然心口痛呀')
    expect(result.intent).toBe('emergency')
    expect(result.riskLevel).toBe('urgent')
    expect(result.answer).toContain('心口痛')
    expect(result.actions?.map((a) => a.type)).toEqual(['notify_family', 'emergency_call'])
  })

  it('非安全詞嘅主動求助都係 urgent', () => {
    const result = engine.analyze('快啲嚟救我')
    expect(result.intent).toBe('emergency')
    expect(result.riskLevel).toBe('urgent')
  })

  it('漏食藥：medication_missed + 藥物名與狀態', () => {
    const result = engine.analyze('我唔記得食降糖藥')
    expect(result.intent).toBe('medication_missed')
    expect(result.extractedData?.medicationName).toBe('降糖藥')
    expect(result.extractedData?.medicationStatus).toBe('missed')
  })

  it('已食藥：medication_taken', () => {
    const result = engine.analyze('我食咗降壓藥')
    expect(result.intent).toBe('medication_taken')
    expect(result.extractedData?.medicationStatus).toBe('taken')
    expect(result.answer).toContain('降壓藥')
  })

  it('覆診／病歷查詢：query_history 標記俾 AssistantService 查 DB', () => {
    const appointment = engine.analyze('我幾時覆診呀？')
    expect(appointment.intent).toBe('appointment_query')
    expect(appointment.actions?.[0].type).toBe('query_history')

    const history = engine.analyze('我想睇吓我嘅病歷紀錄')
    expect(history.intent).toBe('health_history')
    expect(history.actions?.[0].type).toBe('query_history')
  })

  it('政策／醫療資源查詢：kb_search 標記 + queryTopic', () => {
    const policy = engine.analyze('長者醫療券點樣用？')
    expect(policy.intent).toBe('policy_query')
    expect(policy.actions?.[0].type).toBe('kb_search')
    expect(policy.extractedData?.queryTopic).toBe('醫療券')

    const resource = engine.analyze('附近邊間診所能夠睇眼科？')
    expect(resource.intent).toBe('medical_resource_query')
    expect(resource.actions?.[0].type).toBe('kb_search')
  })

  it('家人聯絡／近況查詢', () => {
    const contact = engine.analyze('幫我打電話俾我個仔')
    expect(contact.intent).toBe('family_contact')
    expect(contact.answer).toContain('個仔')
    expect(contact.actions?.[0].type).toBe('notify_family')

    const status = engine.analyze('我個女幾時返嚟？')
    expect(status.intent).toBe('family_status_query')
    expect(status.actions?.[0].type).toBe('query_family_status')
  })

  it('症狀：同理 + 建議', () => {
    const result = engine.analyze('我有啲頭暈')
    expect(result.intent).toBe('symptom')
    expect(result.riskLevel).toBe('normal')
    expect(result.answer).toContain('頭暈')
    expect(result.extractedData?.symptoms).toContain('頭暈')
  })

  it('低血糖：attention + 提醒食嘢', () => {
    const result = engine.analyze('我血糖3.2，有啲攰')
    expect(result.intent).toBe('vital_record')
    expect(result.riskLevel).toBe('attention')
  })

  it('unknown 兜底：溫和回應 + wellbeing note 標記，原文存入 detailedAnswer', () => {
    const result = engine.analyze('今日天氣唔錯')
    expect(result.intent).toBe('unknown')
    expect(result.answer).toContain('記低')
    expect(result.actions?.[0].type).toBe('save_wellbeing_note')
    expect(result.detailedAnswer).toBe('今日天氣唔錯')
  })

  it('空輸入都唔會報錯', () => {
    const result = engine.analyze('')
    expect(result.intent).toBe('unknown')
    expect(result.answer.length).toBeGreaterThan(0)
  })

  /* ---------- 新增四條核心句嘅離線行為 ---------- */

  it('「我啱啱血壓138/82」→ 完整血壓記錄', () => {
    const result = engine.analyze('我啱啱血壓138/82')
    expect(result.intent).toBe('vital_record')
    expect(result.riskLevel).toBe('normal')
    expect(result.answer).toContain('138/82')
    expect(result.answer).toContain('記低')
    expect(result.extractedData?.bloodPressure).toEqual({ systolic: 138, diastolic: 82 })
  })

  it('「我要記血壓」→ 追問上壓下壓，唔會話已記低', () => {
    const result = engine.analyze('我要記血壓')
    expect(result.intent).toBe('vital_record')
    expect(result.answer).toContain('上壓同下壓係幾多')
    expect(result.answer).not.toContain('記低咗')
    expect(result.extractedData?.bloodPressure).toBeUndefined()
  })

  it('「下星期三下午三點去鏡湖覆診」→ 確認句式「幫你記低…啱唔啱？」', () => {
    const result = engine.analyze('下星期三下午三點去鏡湖覆診')
    expect(result.intent).toBe('appointment_query')
    expect(result.answer).toContain('啱唔啱')
    expect(result.answer).toContain('鏡湖')
    expect(result.answer).toContain('15:00')
    expect(result.extractedData?.appointment?.time).toBe('15:00')
    expect(result.extractedData?.appointment?.location).toBe('鏡湖')
    expect(result.extractedData?.appointment?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.actions?.[0].type).toBe('confirm_record')
  })

  it('「我幾時覆診呀？」仍然係查詢（唔會誤入確認句式）', () => {
    const result = engine.analyze('我幾時覆診呀？')
    expect(result.intent).toBe('appointment_query')
    expect(result.actions?.[0].type).toBe('query_history')
  })

  it('「搵我個仔」→ family_contact', () => {
    const result = engine.analyze('搵我個仔')
    expect(result.intent).toBe('family_contact')
    expect(result.answer).toContain('個仔')
    expect(result.actions?.[0].type).toBe('notify_family')
  })

  it('「食咗降壓藥半粒」→ 劑量一併覆述', () => {
    const result = engine.analyze('我食咗降壓藥半粒')
    expect(result.intent).toBe('medication_taken')
    expect(result.answer).toContain('降壓藥')
    expect(result.answer).toContain('0.5粒')
    expect(result.extractedData?.medicationDoseAmount).toBe(0.5)
    expect(result.extractedData?.medicationDoseUnit).toBe('粒')
  })

  it('同樣輸入必然得到同樣輸出（純函數）', () => {
    for (const input of FREE_INPUTS) {
      const a = JSON.stringify(localHybridEngine.analyze(input))
      const b = JSON.stringify(localHybridEngine.analyze(input))
      expect(a).toBe(b)
    }
  })
})

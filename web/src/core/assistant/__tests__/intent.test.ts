import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../intent'

describe('classifyIntent — 13 類 intent 各至少兩種講法', () => {
  it.each([
    // symptom
    ['我有點頭暈', 'symptom'],
    ['我成日頭痛', 'symptom'],
    ['我有点头晕', 'symptom'],
    ['我肚痛呀', 'symptom'],
    // vital_record
    ['血壓155/92', 'vital_record'],
    ['我今朝量到血糖8.1', 'vital_record'],
    ['心跳每分鐘88下，幫我記低', 'vital_record'],
    // medication_taken
    ['我食咗降壓藥', 'medication_taken'],
    ['已經服咗藥', 'medication_taken'],
    ['吃药了', 'medication_taken'],
    // medication_missed
    ['我唔記得食藥', 'medication_missed'],
    ['漏咗食降糖藥', 'medication_missed'],
    ['忘记吃药了', 'medication_missed'],
    // appointment_query
    ['我幾時覆診？', 'appointment_query'],
    ['我個預約係幾號？', 'appointment_query'],
    ['我约了医生复诊是哪天？', 'appointment_query'],
    // health_history
    ['我想睇吓我嘅病歷', 'health_history'],
    ['我嘅血壓記錄係點？', 'health_history'],
    ['我想查吓以前嘅病歷紀錄', 'health_history'],
    // policy_query
    ['醫療券點樣用？', 'policy_query'],
    ['有咩津貼可以申請？', 'policy_query'],
    ['長者咭有咩優惠？', 'policy_query'],
    // medical_resource_query
    ['附近邊間診所能夠睇眼科？', 'medical_resource_query'],
    ['附近有咩社區中心？', 'medical_resource_query'],
    ['邊度有健康中心？', 'medical_resource_query'],
    // family_contact
    ['幫我打電話俾我個仔', 'family_contact'],
    ['我想聯絡我個女', 'family_contact'],
    ['通知一下我家人', 'family_contact'],
    // family_status_query
    ['我個仔幾時返嚟？', 'family_status_query'],
    ['我個女而家喺邊？', 'family_status_query'],
    ['阿孫最近有冇消息？', 'family_status_query'],
    // emergency（安全詞即時觸發）
    ['我心口痛呀', 'emergency'],
    ['我呼吸唔到', 'emergency'],
    ['快啲嚟救我', 'emergency'],
    // general_health_question
    ['點樣先可以瞓得好啲？', 'general_health_question'],
    ['長者每日應該飲幾多水？', 'general_health_question'],
    ['點解血壓會高？', 'general_health_question'],
    // unknown
    ['今日天氣唔錯', 'unknown'],
    ['多謝你', 'unknown'],
    ['你係邊個？', 'unknown'],
  ])('「%s」→ %s', (text, expected) => {
    expect(classifyIntent(text)).toBe(expected)
  })

  it('同一意思唔同講法得到相同 intent（泛化驗證）', () => {
    expect(classifyIntent('我唔記得食藥')).toBe('medication_missed')
    expect(classifyIntent('忘记吃药了')).toBe('medication_missed')
    expect(classifyIntent('漏咗食藥')).toBe('medication_missed')

    expect(classifyIntent('我幾時覆診？')).toBe('appointment_query')
    expect(classifyIntent('我约了医生复诊是哪天？')).toBe('appointment_query')
  })

  it('空輸入回傳 unknown，唔會報錯', () => {
    expect(classifyIntent('')).toBe('unknown')
    expect(classifyIntent('   ')).toBe('unknown')
  })
})

describe('classifyIntent — 新增能力（搵家人／記覆診／記血壓追問）', () => {
  it.each([
    // family_contact 新詞：搵阿仔／搵阿女／搵屋企人／通知監護人
    ['搵阿仔', 'family_contact'],
    ['搵阿女傾吓偈', 'family_contact'],
    ['搵屋企人', 'family_contact'],
    ['搵我個仔', 'family_contact'],
    ['通知監護人', 'family_contact'],
    // appointment 記錄類語句（13-intent 合約內仍歸 appointment_query）
    ['幫我記覆診', 'appointment_query'],
    ['記一記我聽日覆診', 'appointment_query'],
    // 想記生命體徵但未講數值 → vital_record（引擎追問）
    ['我要記血壓', 'vital_record'],
    ['幫我記血糖', 'vital_record'],
  ])('「%s」→ %s', (text, expected) => {
    expect(classifyIntent(text)).toBe(expected)
  })

  it('「搵」無家人對象時唔會誤判 family_contact', () => {
    expect(classifyIntent('我想搵吓以前嘅紀錄')).not.toBe('family_contact')
  })

  it('覆診查詢語句唔受記錄規則影響', () => {
    expect(classifyIntent('我幾時覆診？')).toBe('appointment_query')
    expect(classifyIntent('我嘅血壓記錄最近點呀？')).not.toBe('vital_record')
  })
})

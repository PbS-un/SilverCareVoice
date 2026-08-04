import { describe, expect, it } from 'vitest'
import { HIGH_RISK_TERMS, screenHighRiskTerms } from '../safetyScreen'

describe('screenHighRiskTerms', () => {
  it('命中高風險詞時 triggered=true 並回傳命中詞', () => {
    const result = screenHighRiskTerms('我突然心口痛呀')
    expect(result.triggered).toBe(true)
    expect(result.matchedTerms).toContain('心口痛')
  })

  it.each([
    '我呼吸困難',
    '阿婆暈倒咗',
    '佢跌親郁唔到',
    '我講唔到嘢',
    '突然半邊冇力',
    '胸口好胸悶',
    '喘唔到氣呀',
  ])('「%s」應該觸發', (text) => {
    expect(screenHighRiskTerms(text).triggered).toBe(true)
  })

  it('每個高風險詞單獨出現都會觸發', () => {
    for (const term of HIGH_RISK_TERMS) {
      const result = screenHighRiskTerms(`我${term}呀`)
      expect(result.triggered, `術語「${term}」應觸發`).toBe(true)
      expect(result.matchedTerms).toContain(term)
    }
  })

  it.each([
    '我有點頭暈',
    '我今朝量到血壓155/92',
    '我心悒呀',
    '今日幾開心',
    '我唔記得食藥',
  ])('「%s」唔應該觸發', (text) => {
    const result = screenHighRiskTerms(text)
    expect(result.triggered).toBe(false)
    expect(result.matchedTerms).toEqual([])
  })

  it('空輸入唔會觸發', () => {
    expect(screenHighRiskTerms('').triggered).toBe(false)
  })
})

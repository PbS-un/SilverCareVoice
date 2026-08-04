/**
 * 高風險安全篩查 —— 必須喺任何 LLM / 本地引擎分析之前執行。
 * 命中任何高風險詞即視為緊急情況，由引擎即時給出 urgent 回應。
 */

/** 高風險詞列表（粵語 + 書面語變體） */
export const HIGH_RISK_TERMS: readonly string[] = [
  '胸痛',
  '胸口痛',
  '心口痛',
  '胸悶',
  '呼吸困難',
  '呼吸唔到',
  '喘唔到氣',
  '暈倒',
  '昏迷',
  '失去意識',
  '跌倒起不來',
  '跌親郁唔到',
  '大量出血',
  '突然說話困難',
  '講唔到嘢',
  '身體一邊無力',
  '半邊冇力',
] as const

export interface SafetyScreenResult {
  /** 係咪命中任何高風險詞 */
  triggered: boolean
  /** 命中咗邊啲詞（原文用語） */
  matchedTerms: string[]
}

/**
 * 純函數：掃描輸入文字有冇高風險詞。
 * 用簡單子字串匹配 —— 高風險詞本身已經夠具體，唔怕誤觸，寧願寧緊莫漏。
 */
export function screenHighRiskTerms(text: string): SafetyScreenResult {
  if (!text) {
    return { triggered: false, matchedTerms: [] }
  }
  const matchedTerms = HIGH_RISK_TERMS.filter((term) => text.includes(term))
  return {
    triggered: matchedTerms.length > 0,
    matchedTerms,
  }
}

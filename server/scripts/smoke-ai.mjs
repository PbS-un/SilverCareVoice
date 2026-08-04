/** 臨時驗證：safety 路徑 + fallback 路徑（需 server 帶 dummy key 運行） */
const BASE = 'http://localhost:8787'

const post = (body) =>
  fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

// 1) safety：高風險詞 → provider:'safety'，不調 LLM（即時回）
const t0 = Date.now()
const safety = await post({ text: '我突然心口痛，仲有啲呼吸唔到' })
console.log(`[safety] ${Date.now() - t0}ms`, JSON.stringify(safety, null, 2))
console.log(
  'PASS safety:',
  safety.provider === 'safety' &&
    safety.analysis.intent === 'emergency' &&
    safety.analysis.riskLevel === 'urgent' &&
    Array.isArray(safety.analysis.actions),
)

// 2) fallback：dummy key → DeepSeek 401 → provider:'fallback'
const t1 = Date.now()
const fb = await post({ text: '我今朝量血壓，上壓 138 下壓 85' })
console.log(`[fallback] ${Date.now() - t1}ms`, JSON.stringify(fb, null, 2))
console.log('PASS fallback:', fb.provider === 'fallback')

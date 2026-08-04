/**
 * SilverCare server 冒煙驗證腳本（需 server 已在 8787 運行）
 * 用法：node server/scripts/smoke.mjs
 *
 * 需與運行中 server 相同的 SYNC_TOKEN：
 *   PowerShell： $env:SYNC_TOKEN='<server 日誌中的 token>' ; node server/scripts/smoke.mjs
 * （server 啟動日誌會打印 SYNC_TOKEN=…；若 server/.env 有固定 token 直接用該值）
 *
 * 覆蓋：health / AI chat / 無 token 401（HTTP+WS）/ push 每筆 op 結果
 * （applied/rejected/duplicated）/ LWW tiebreaker / seq cursor（慢時鐘 op
 * 不遺漏）/ bootstrap cursor / pull 分頁游標驗證。
 */
import WebSocket from 'ws'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8787'
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws'
const TOKEN = process.env.SYNC_TOKEN ?? process.env.SMOKE_TOKEN ?? ''
let pass = 0
let fail = 0

function check(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  PASS  ${name}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${name} ${extra}`)
  }
}

if (!TOKEN) {
  console.error('缺少 SYNC_TOKEN：請設定環境變數（與 server 一致），例：')
  console.error("  $env:SYNC_TOKEN='<token>' ; node server/scripts/smoke.mjs")
  process.exit(1)
}

const AUTH = { Authorization: `Bearer ${TOKEN}` }
const j = (r) => r.json()

// ---- 1. health ----
console.log('\n[1] /api/health')
const health = await j(await fetch(`${BASE}/api/health`))
check('ok:true', health.ok === true, JSON.stringify(health))

// ---- 2. /api/ai/chat ----
console.log('\n[2] /api/ai/chat')
const chat = await j(
  await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '我今朝量血壓，上壓 138 下壓 85' }),
  }),
)
console.log('   response:', JSON.stringify(chat))
check('provider 為 local|safety|deepseek|fallback', ['local', 'safety', 'deepseek', 'fallback'].includes(chat.provider))

const bad = await fetch(`${BASE}/api/ai/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
})
check('空 body → 400', bad.status === 400, `status=${bad.status}`)

// ---- 3. 鑑權：無 token / 錯 token → 401（Warning 5）----
console.log('\n[3] /sync/* 鑑權（無 token / 錯 token → 401）')
const noTok1 = await fetch(`${BASE}/sync/bootstrap`)
check('GET /sync/bootstrap 無 token → 401', noTok1.status === 401, `status=${noTok1.status}`)
const noTok2 = await fetch(`${BASE}/sync/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'x', ops: [] }),
})
check('POST /sync/push 無 token → 401', noTok2.status === 401, `status=${noTok2.status}`)
const noTok3 = await fetch(`${BASE}/sync/pull?since=0`)
check('GET /sync/pull 無 token → 401', noTok3.status === 401, `status=${noTok3.status}`)
const badTok = await fetch(`${BASE}/sync/bootstrap`, { headers: { Authorization: 'Bearer wrong-token' } })
check('錯 token → 401', badTok.status === 401, `status=${badTok.status}`)
const qTok = await fetch(`${BASE}/sync/bootstrap?token=${encodeURIComponent(TOKEN)}`)
check('query ?token= 亦可過關 → 200', qTok.status === 200, `status=${qTok.status}`)

// WS hello 無 token → auth_error 並斷線
const wsNoAuth = await new Promise((resolve) => {
  const ws = new WebSocket(WS_URL)
  const result = { authError: false, helloOk: false }
  const timer = setTimeout(() => {
    try { ws.terminate() } catch { /* ignore */ }
    resolve(result)
  }, 3000)
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId: 'no-token-device' })))
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString())
    if (msg.type === 'auth_error') result.authError = true
    if (msg.type === 'hello_ok') result.helloOk = true
  })
  ws.on('close', () => { clearTimeout(timer); resolve(result) })
  ws.on('error', () => { clearTimeout(timer); resolve(result) })
})
check('WS hello 無 token → auth_error 且未 hello_ok', wsNoAuth.authError && !wsNoAuth.helloOk)

// ---- 4. WS：兩裝置註冊（帶 token）+ change 廣播 ----
console.log('\n[4] WS /ws hello（token）+ change 廣播')
const connect = (deviceId) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const messages = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId, token: TOKEN })))
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString())
      messages.push(msg)
      if (msg.type === 'hello_ok') resolve({ ws, messages })
    })
    ws.on('error', reject)
    setTimeout(() => reject(new Error(`hello timeout: ${deviceId}`)), 4000)
  })

const a = await connect('device-A')
const b = await connect('device-B')
check('兩裝置 hello_ok', a.messages[0]?.type === 'hello_ok' && b.messages[0]?.type === 'hello_ok')

const now = Date.now()
const iso = (offsetMs) => new Date(now + offsetMs).toISOString()
const ops = [
  { id: `op-${now}-1`, tbl: 'VitalRecord', entityId: 'v1', updatedAt: iso(1), type: 'put', payload: { systolic: 138, diastolic: 85 } },
  { id: `op-${now}-2`, tbl: 'Medication', entityId: 'm1', updatedAt: iso(2), type: 'put', payload: { name: '降壓藥', dose: '1粒' } },
]

// ---- 5. push：每筆 op 應用結果（Warning 4）----
console.log('\n[5] POST /sync/push（applied/rejected/duplicated）')
const pushRes = (body) =>
  fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify(body),
  })

const push1 = await j(await pushRes({ deviceId: 'device-A', ops }))
console.log('   response:', JSON.stringify(push1))
check('applied 為 2 筆 op id 陣列', Array.isArray(push1.applied) && push1.applied.length === 2, JSON.stringify(push1))
check('rejected/duplicated 陣列存在', Array.isArray(push1.rejected) && Array.isArray(push1.duplicated))
check('serverTime 存在', typeof push1.serverTime === 'string')

// 等 WS 廣播
await new Promise((r) => setTimeout(r, 500))
const bChange = b.messages.find((m) => m.type === 'change')
const aChange = a.messages.find((m) => m.type === 'change')
check('device-B 收到 change', Boolean(bChange) && bChange.ops?.length === 2 && bChange.originDeviceId === 'device-A')
check('device-A（來源）未收到 change', !aChange)

// LWW：較舊 updatedAt → rejected（記入日誌但不覆蓋狀態）
const staleOp = { id: `op-${now}-stale`, tbl: 'VitalRecord', entityId: 'v1', updatedAt: iso(-100000), type: 'put', payload: { systolic: 1 } }
const stalePush = await j(await pushRes({ deviceId: 'device-B', ops: [staleOp] }))
check('LWW 較舊 op → applied 0 且 rejected 含該 op id', Array.isArray(stalePush.applied) && stalePush.applied.length === 0 && stalePush.rejected.includes(staleOp.id), JSON.stringify(stalePush))

// 重複 op id → duplicated
const dupPush = await j(await pushRes({ deviceId: 'device-A', ops: [ops[0]] }))
check('重複 op id → duplicated 含該 op id', dupPush.duplicated.includes(ops[0].id), JSON.stringify(dupPush))

// del tombstone
const delOp = { id: `op-${now}-del`, tbl: 'Medication', entityId: 'm1', updatedAt: iso(3), type: 'del' }
const delPush = await j(await pushRes({ deviceId: 'device-B', ops: [delOp] }))
check('del op → applied 含該 op id', delPush.applied.includes(delOp.id), JSON.stringify(delPush))

// 白名單外 tbl → 400
const badTbl = await pushRes({ deviceId: 'x', ops: [{ id: 'z', tbl: 'Hack', entityId: 'e', updatedAt: iso(1), type: 'put' }] })
check('非白名單 tbl → 400', badTbl.status === 400, `status=${badTbl.status}`)

// ---- 6. bootstrap：含 cursor（seq）----
console.log('\n[6] GET /sync/bootstrap')
const boot = await j(await fetch(`${BASE}/sync/bootstrap`, { headers: AUTH }))
const v1 = boot.entities.find((e) => e.tbl === 'VitalRecord' && e.entityId === 'v1')
const m1 = boot.entities.find((e) => e.tbl === 'Medication' && e.entityId === 'm1')
check('VitalRecord v1 存在且 systolic=138', v1?.payload?.systolic === 138, JSON.stringify(v1))
check('VitalRecord v1 帶 deviceId（tiebreaker 用）', v1?.deviceId === 'device-A', JSON.stringify(v1?.deviceId))
check('Medication m1 tombstone deleted:true', m1?.deleted === true, JSON.stringify(m1))
check('bootstrap cursor 為數字字串（seq）', typeof boot.cursor === 'string' && /^\d+$/.test(boot.cursor), `cursor=${boot.cursor}`)

// ---- 7. pull：seq cursor 增量（Critical 1）----
console.log('\n[7] GET /sync/pull?since=<seq>（server 單調游標）')
const pull0 = await j(await fetch(`${BASE}/sync/pull?since=0`, { headers: AUTH }))
check('since=0 取回全部 ops（≥5 筆：2 put + stale + dup 不計 + del）', pull0.ops.length >= 4, `got ${pull0.ops.length}`)
check('cursor 為數字字串', /^\d+$/.test(pull0.cursor), `cursor=${pull0.cursor}`)
check('每筆 op 帶 seq 且單調遞增', pull0.ops.every((op, i) => typeof op.seq === 'number' && (i === 0 || op.seq > pull0.ops[i - 1].seq)))

const pull2 = await j(await fetch(`${BASE}/sync/pull?since=${pull0.cursor}`, { headers: AUTH }))
check('以 cursor 再拉 → 0 筆', pull2.ops.length === 0, `got ${pull2.ops.length}`)
check('無新資料時 cursor 不變', pull2.cursor === pull0.cursor, `${pull2.cursor} vs ${pull0.cursor}`)

// 慢時鐘裝置：updatedAt 早於一切既有資料，push 後仍必須可被 pull 到（seq 游標不遺漏）
const slowClockOp = { id: `op-${now}-slowclock`, tbl: 'SymptomRecord', entityId: 'sc1', updatedAt: '2000-01-01T00:00:00.000Z', type: 'put', payload: { description: '慢時鐘裝置' } }
const slowPush = await j(await pushRes({ deviceId: 'device-slow', ops: [slowClockOp] }))
check('慢時鐘 op push 成功', slowPush.applied.includes(slowClockOp.id), JSON.stringify(slowPush))
const pullAfterSlow = await j(await fetch(`${BASE}/sync/pull?since=${pull0.cursor}`, { headers: AUTH }))
check('慢時鐘 op（updatedAt 遠早於游標對應時間）仍可被 pull 取到', pullAfterSlow.ops.some((op) => op.id === slowClockOp.id), `got ${pullAfterSlow.ops.map((o) => o.id).join(',')}`)

const badSince = await fetch(`${BASE}/sync/pull?since=${encodeURIComponent('2026-01-01T00:00:00.000Z')}`, { headers: AUTH })
check('舊語義 ISO since → 400（游標必須是 seq）', badSince.status === 400, `status=${badSince.status}`)
const badSince2 = await fetch(`${BASE}/sync/pull?since=abc`, { headers: AUTH })
check('非法 since → 400', badSince2.status === 400, `status=${badSince2.status}`)

a.ws.close()
b.ws.close()

console.log(`\n結果：${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)

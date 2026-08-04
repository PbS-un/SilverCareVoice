/**
 * SilverCare server 冒煙驗證腳本（需 server 已在 8787 運行）
 * 用法：node server/scripts/smoke.mjs
 */
import WebSocket from 'ws'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:8787'
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws'
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

// ---- 3. WS：兩裝置註冊 + change 廣播 ----
console.log('\n[3] WS /ws hello + change 廣播')
const connect = (deviceId) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const messages = []
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId })))
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

// ---- 4. push ----
console.log('\n[4] POST /sync/push')
const push1 = await j(
  await fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-A', ops }),
  }),
)
console.log('   response:', JSON.stringify(push1))
check('applied === 2', push1.applied === 2, JSON.stringify(push1))
check('serverTime 存在', typeof push1.serverTime === 'string')

// 等 WS 廣播
await new Promise((r) => setTimeout(r, 500))
const bChange = b.messages.find((m) => m.type === 'change')
const aChange = a.messages.find((m) => m.type === 'change')
check('device-B 收到 change', Boolean(bChange) && bChange.ops?.length === 2 && bChange.originDeviceId === 'device-A')
check('device-A（來源）未收到 change', !aChange)

// LWW：較舊 updatedAt 不應覆蓋
const stalePush = await j(
  await fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'device-B',
      ops: [{ id: `op-${now}-stale`, tbl: 'VitalRecord', entityId: 'v1', updatedAt: iso(-100000), type: 'put', payload: { systolic: 1 } }],
    }),
  }),
)
check('LWW 較舊 op → applied 0', stalePush.applied === 0, JSON.stringify(stalePush))

// del tombstone
const delPush = await j(
  await fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'device-B',
      ops: [{ id: `op-${now}-del`, tbl: 'Medication', entityId: 'm1', updatedAt: iso(3), type: 'del' }],
    }),
  }),
)
check('del op → applied 1', delPush.applied === 1, JSON.stringify(delPush))

// 白名單外 tbl → 400
const badTbl = await fetch(`${BASE}/sync/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'x', ops: [{ id: 'z', tbl: 'Hack', entityId: 'e', updatedAt: iso(1), type: 'put' }] }),
})
check('非白名單 tbl → 400', badTbl.status === 400, `status=${badTbl.status}`)

// ---- 5. bootstrap ----
console.log('\n[5] GET /sync/bootstrap')
const boot = await j(await fetch(`${BASE}/sync/bootstrap`))
const v1 = boot.entities.find((e) => e.tbl === 'VitalRecord' && e.entityId === 'v1')
const m1 = boot.entities.find((e) => e.tbl === 'Medication' && e.entityId === 'm1')
check('VitalRecord v1 存在且 systolic=138', v1?.payload?.systolic === 138, JSON.stringify(v1))
check('Medication m1 tombstone deleted:true', m1?.deleted === true, JSON.stringify(m1))

// ---- 6. pull 增量 ----
console.log('\n[6] GET /sync/pull?since=')
const pull1 = await j(await fetch(`${BASE}/sync/pull?since=${encodeURIComponent(iso(0))}`))
check('pull 取回 3 筆增量 ops', pull1.ops.length === 3, `got ${pull1.ops.length}`)
check('cursor 存在', typeof pull1.cursor === 'string')
const pull2 = await j(await fetch(`${BASE}/sync/pull?since=${encodeURIComponent(pull1.cursor)}`))
check('以 cursor 再拉 → 0 筆', pull2.ops.length === 0, `got ${pull2.ops.length}`)
const badSince = await fetch(`${BASE}/sync/pull?since=abc`)
check('非法 since → 400', badSince.status === 400, `status=${badSince.status}`)

a.ws.close()
b.ws.close()

console.log(`\n結果：${pass} pass / ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)

/**
 * T8 Sync 雙裝置整合驗證腳本（純 Node，不依賴瀏覽器）
 *
 * 場景：
 *   c) 無 token 訪問 /sync/bootstrap → 401（Warning 5）
 *   基本：device A push → device B 經 WS 收到 change，pull 可見（--no-ws 時跳過 WS 段）
 *   b) 慢時鐘 op（updatedAt 早於 cursor 對應時間）push 後仍可被 pull 取到（Critical 1）
 *   a) device A demo reset（tombstone + 重蓋章 seed put）→ device B 收斂到 seed，不分叉（Critical 2）
 *
 * 用法（server 需已運行於 localhost:8787，且需與 server 一致的 SYNC_TOKEN）：
 *   $env:SYNC_TOKEN='<token>' ; node web/src/data/sync/scripts/two-device-check.mjs [baseUrl] [--no-ws]
 *
 *   --no-ws：跳過所有 WebSocket 相關斷言（WS 連線註冊、change 廣播即時性），
 *     僅驗證 HTTP 合約場景（401 鑑權、push/pull、seq 游標、慢時鐘 op、reset 收斂）。
 *     用於 Supabase Edge Function 雲端後端（雲端無 /ws，改以 Realtime broadcast + 輪詢）。
 *
 *   雲端模式需另設 SYNC_APIKEY（= Supabase anon/publishable key）：Edge Function
 *   網關要求 apikey 標頭；sync token 仍以 Authorization: Bearer 傳遞（函數兩者並存）。
 *     $env:SYNC_TOKEN='<token>' ; $env:SYNC_APIKEY='<anon key>' ; node ... <cloud baseUrl> --no-ws
 *
 * 成功輸出 "PASS" 並 exit 0；失敗 exit 1。
 */
import WebSocket from 'ws'

const args = process.argv.slice(2)
const NO_WS = args.includes('--no-ws')
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:8787'
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws'
const TOKEN = process.env.SYNC_TOKEN ?? ''
/** 雲端網關 apikey（可選）：設定後所有請求附 apikey 與 Bearer 並存。 */
const APIKEY = process.env.SYNC_APIKEY ?? ''
const TIMEOUT_MS = 30_000

const ts = Date.now()
const deviceA = `dev-integ-A-${ts}`
const deviceB = `dev-integ-B-${ts}`
const entityId = `integ-vital-${ts}`

function fail(msg) {
  console.error(`[FAIL] ${msg}`)
  process.exit(1)
}

if (!TOKEN) fail('缺少 SYNC_TOKEN 環境變數（需與 server 一致；見 server 啟動日誌）')

const AUTH = { Authorization: `Bearer ${TOKEN}`, ...(APIKEY ? { apikey: APIKEY } : {}) }
/** 純健康／無鑑權請求的標頭（雲端網關仍需 apikey）。 */
const PLAIN = APIKEY ? { apikey: APIKEY } : {}
const timer = setTimeout(() => fail(`timeout（${TIMEOUT_MS}ms 內未完成）`), TIMEOUT_MS)

/** 客戶端 LWW apply 模擬（與 SyncClient.applyOps / server pushOps 同規則）。 */
function applyLocal(state, op, writer) {
  const cur = state.get(op.entityId)
  if (cur) {
    const wins =
      op.updatedAt > cur.updatedAt ||
      (op.updatedAt === cur.updatedAt && writer > cur.writer)
    if (!wins) return
  }
  if (op.type === 'del') state.delete(op.entityId)
  else state.set(op.entityId, { ...op.payload, updatedAt: op.updatedAt, writer })
}

// 0) health
try {
  const h = await fetch(`${BASE}/api/health`, { headers: PLAIN })
  if (!h.ok) fail(`/api/health 回傳 ${h.status}`)
} catch (e) {
  fail(`無法連線 server（${BASE}）：${e.message}。請先執行 npm run dev:server`)
}
console.log('[ok] /api/health 可達')

// c) 無 token → 401（帶 apikey 但不帶 sync token，驗證的是函數層鑑權而非網關層）
{
  const r = await fetch(`${BASE}/sync/bootstrap`, { headers: PLAIN })
  if (r.status !== 401) fail(`無 token /sync/bootstrap 應回 401，實際 ${r.status}`)
  console.log('[ok] 無 token 訪問 /sync/bootstrap → 401')
}

// 1) device B：WS 連線並註冊（hello 帶 token）；--no-ws 時整段跳過並直接跑 main
const stateB = new Map() // device B 本地狀態模擬
let ws = null
let changeCount = 0
if (!NO_WS) {
  ws = new WebSocket(WS_URL)
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId: deviceB, token: TOKEN })))
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'hello_ok') {
      console.log('[ok] device B WS 註冊成功（hello_ok，token 驗證通過）')
      void main()
    } else if (msg.type === 'auth_error') {
      fail(`device B hello 被拒（auth_error）：token 與 server 不符？`)
    } else if (msg.type === 'change') {
      changeCount += 1
      if (changeCount === 1) {
        const hit = (msg.ops ?? []).some((op) => op.entityId === entityId && op.tbl === 'VitalRecord')
        if (!hit) return
        console.log(`[ok] device B 收到 change（origin=${msg.originDeviceId}，entityId=${entityId}）`)
      }
    }
  })
  ws.on('error', (e) => fail(`device B WS 錯誤：${e.message}`))
} else {
  console.log('[skip] --no-ws：跳過 WS 連線註冊與 change 廣播斷言（僅驗證 HTTP 合約）')
  void main()
}

async function pushAs(deviceId, ops) {
  const res = await fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ deviceId, ops }),
  })
  if (!res.ok) fail(`push（${deviceId}）回傳 ${res.status}: ${await res.text()}`)
  return res.json()
}

async function pullOps(since) {
  const res = await fetch(`${BASE}/sync/pull?since=${encodeURIComponent(since)}`, { headers: AUTH })
  if (!res.ok) fail(`/sync/pull 回傳 ${res.status}`)
  return res.json()
}

async function main() {
  if (!NO_WS) await new Promise((r) => setTimeout(r, 200)) // 確保 B 已註冊（--no-ws 無需等待）

  // 2) 基本：device A push 一筆 VitalRecord
  const now = new Date().toISOString()
  const first = await pushAs(deviceA, [
    {
      id: `op-${entityId}`,
      tbl: 'VitalRecord',
      entityId,
      updatedAt: now,
      type: 'put',
      payload: {
        id: entityId, elderId: 'seed-elder-1', type: 'heart_rate', value: 72, unit: 'bpm',
        measuredAt: now, source: 'voice', createdAt: now, updatedAt: now,
      },
    },
  ])
  if (!first.applied.includes(`op-${entityId}`)) fail(`device A push 未被 applied：${JSON.stringify(first)}`)
  console.log(`[ok] device A push 成功（applied=${first.applied.length}）`)

  // 3) pull 確認（seq 游標）
  const bootCursor = await (async () => {
    const res = await fetch(`${BASE}/sync/bootstrap`, { headers: AUTH })
    const body = await res.json()
    if (!/^\d+$/.test(String(body.cursor))) fail(`bootstrap cursor 非 seq：${body.cursor}`)
    return body.cursor
  })()
  const p1 = await pullOps(0)
  if (!p1.ops.some((op) => op.entityId === entityId)) fail('/sync/pull 未包含剛寫入的記錄')
  if (!/^\d+$/.test(String(p1.cursor))) fail(`pull cursor 非 seq：${p1.cursor}`)
  console.log(`[ok] /sync/pull 可讀取該筆記錄（cursor=${p1.cursor}，seq 語義）`)

  // b) 慢時鐘 op：updatedAt 遠早於現有游標對應時間，push 後仍須可被 pull 到
  const slowOpId = `op-slow-${ts}`
  const slow = await pushAs(deviceA, [
    {
      id: slowOpId, tbl: 'SymptomRecord', entityId: `integ-slow-${ts}`,
      updatedAt: '2000-01-01T00:00:00.000Z', type: 'put',
      payload: { id: `integ-slow-${ts}`, description: '慢時鐘裝置的記錄' },
    },
  ])
  if (!slow.applied.includes(slowOpId)) fail(`慢時鐘 op 未被 applied：${JSON.stringify(slow)}`)
  const p2 = await pullOps(p1.cursor) // 以「時間上遠在之後」的游標續拉
  if (!p2.ops.some((op) => op.id === slowOpId)) {
    fail('慢時鐘 op（updatedAt 早於游標時間）未被 pull 取到 —— seq 游標修復失效')
  }
  console.log('[ok] 慢時鐘 op（updatedAt 早於游標）經 push 後仍可被 pull 取到')

  // a) demo reset 收斂：A 先建立一筆記錄，B 同步到；A reset（del + 重蓋章 seed put），
  //    B 以 pull + LWW 收斂到 seed，且與 server 狀態一致（不分叉）
  const resetEntityId = `integ-reset-${ts}`
  const t0 = new Date().toISOString()
  const created = await pushAs(deviceA, [
    {
      id: `op-r0-${ts}`, tbl: 'VitalRecord', entityId: resetEntityId, updatedAt: t0, type: 'put',
      payload: { id: resetEntityId, value: 111, unit: 'X', createdAt: t0, updatedAt: t0 },
    },
  ])
  if (!created.applied.includes(`op-r0-${ts}`)) fail(`reset 前置寫入失敗：${JSON.stringify(created)}`)

  // B 端：pull 到 A 的寫入為止，建立本地狀態
  const p3 = await pullOps(p2.cursor)
  for (const op of [...p2.ops, ...p3.ops]) applyLocal(stateB, op, op.deviceId ?? deviceA)
  if (!stateB.has(resetEntityId)) fail('device B 未同步到 reset 前置記錄')

  // A 端 demo reset（與 SyncedProvider.reset 同語義）：
  //   tombstone（現在時刻）→ seed put 重蓋章（嚴格晚於 tombstone）
  const delTs = new Date().toISOString()
  const seedTs = new Date(Date.parse(delTs) + 1).toISOString()
  const seedValue = 999
  const reset = await pushAs(deviceA, [
    { id: `op-rdel-${ts}`, tbl: 'VitalRecord', entityId: resetEntityId, updatedAt: delTs, type: 'del' },
    {
      id: `op-rseed-${ts}`, tbl: 'VitalRecord', entityId: resetEntityId, updatedAt: seedTs, type: 'put',
      payload: { id: resetEntityId, value: seedValue, unit: 'seed', createdAt: t0, updatedAt: seedTs }, // createdAt 保留原值
    },
  ])
  if (reset.applied.length !== 2) fail(`reset push 應 applied 2 筆：${JSON.stringify(reset)}`)

  // B 端：pull 增量並 LWW apply → 必須收斂到 seed（不被 tombstone 清空、不永久分叉）
  const p4 = await pullOps(p3.cursor)
  if (p4.ops.length < 2) fail(`B 未收到 reset 增量 ops（got ${p4.ops.length}）`)
  for (const op of p4.ops) applyLocal(stateB, op, op.deviceId ?? deviceA)
  const bState = stateB.get(resetEntityId)
  if (!bState || bState.value !== seedValue) {
    fail(`device B 未收斂到 seed（期望 value=${seedValue}）：${JSON.stringify(bState ?? null)}`)
  }
  if (bState.createdAt !== t0) fail(`device B 收斂結果 createdAt 應保留原值：${JSON.stringify(bState)}`)

  // server 端狀態與 B 一致（收斂、無分叉）
  const boot2 = await (async () => {
    const res = await fetch(`${BASE}/sync/bootstrap`, { headers: AUTH })
    return res.json()
  })()
  const srv = boot2.entities.find((e) => e.tbl === 'VitalRecord' && e.entityId === resetEntityId)
  if (!srv || srv.deleted || srv.payload?.value !== seedValue) {
    fail(`server 狀態與 seed 不一致：${JSON.stringify(srv ?? null)}`)
  }
  console.log('[ok] device A reset 後，device B 與 server 收斂到 seed（不分叉、tombstone < seed put）')

  clearTimeout(timer)
  ws?.close()
  console.log(
    NO_WS
      ? 'PASS：雙裝置同步 HTTP 合約（401 鑑權 + push/pull + seq 游標 + 慢時鐘不遺漏 + reset 收斂）全部正常（--no-ws：WS 廣播斷言已跳過）'
      : 'PASS：雙裝置同步（WS 廣播 + seq 游標 + 慢時鐘不遺漏 + reset 收斂 + token 鑑權）全部正常',
  )
  process.exit(0)
}

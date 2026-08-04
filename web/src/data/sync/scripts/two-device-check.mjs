/**
 * T8 Sync 雙裝置整合驗證腳本（純 Node，不依賴瀏覽器）
 *
 * 模擬兩台裝置：
 *   device A → POST /sync/push 寫入一筆 VitalRecord
 *   device B → WS /ws 註冊後應收到 { type:'change' }，且 GET /sync/pull 可見
 *
 * 用法（server 需已運行於 localhost:8787）：
 *   node web/src/data/sync/scripts/two-device-check.mjs [baseUrl]
 * 成功輸出 "PASS" 並 exit 0；失敗 exit 1。
 */
import WebSocket from 'ws'

const BASE = process.argv[2] ?? 'http://localhost:8787'
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws'
const TIMEOUT_MS = 10_000

const ts = Date.now()
const deviceA = `dev-integ-A-${ts}`
const deviceB = `dev-integ-B-${ts}`
const entityId = `integ-vital-${ts}`

function fail(msg) {
  console.error(`[FAIL] ${msg}`)
  process.exit(1)
}

const timer = setTimeout(() => fail(`timeout（${TIMEOUT_MS}ms 內未完成）`), TIMEOUT_MS)

// 0) health
try {
  const h = await fetch(`${BASE}/api/health`)
  if (!h.ok) fail(`/api/health 回傳 ${h.status}`)
} catch (e) {
  fail(`無法連線 server（${BASE}）：${e.message}。請先執行 npm run dev:server`)
}
console.log('[ok] /api/health 可達')

// 1) device B：WS 連線並註冊
const ws = new WebSocket(WS_URL)
let bRegistered = false
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId: deviceB })))
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'hello_ok') {
    bRegistered = true
    console.log('[ok] device B WS 註冊成功（hello_ok）')
    void deviceAPush()
  } else if (msg.type === 'change') {
    const hit = (msg.ops ?? []).some((op) => op.entityId === entityId && op.tbl === 'VitalRecord')
    if (!hit) return
    console.log(`[ok] device B 收到 change（origin=${msg.originDeviceId}，entityId=${entityId}）`)
    void verifyPull()
  }
})
ws.on('error', (e) => fail(`device B WS 錯誤：${e.message}`))

// 2) device A：push 一筆 VitalRecord
async function deviceAPush() {
  await new Promise((r) => setTimeout(r, 200)) // 確保 B 已註冊
  const now = new Date().toISOString()
  const body = {
    deviceId: deviceA,
    ops: [
      {
        id: `op-${entityId}`,
        tbl: 'VitalRecord',
        entityId,
        updatedAt: now,
        type: 'put',
        payload: {
          id: entityId,
          elderId: 'seed-elder-1',
          type: 'heart_rate',
          value: 72,
          unit: 'bpm',
          measuredAt: now,
          source: 'voice',
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  }
  const res = await fetch(`${BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) fail(`device A push 回傳 ${res.status}: ${await res.text()}`)
  const j = await res.json()
  console.log(`[ok] device A push 成功（applied=${j.applied}）`)
}

// 3) 再以 pull 確認 server 端狀態包含該筆
async function verifyPull() {
  const since = new Date(Date.now() - 60_000).toISOString()
  const res = await fetch(`${BASE}/sync/pull?since=${encodeURIComponent(since)}`)
  if (!res.ok) fail(`/sync/pull 回傳 ${res.status}`)
  const { ops } = await res.json()
  if (!ops.some((op) => op.entityId === entityId)) fail('/sync/pull 未包含剛寫入的記錄')
  console.log('[ok] /sync/pull 可讀取該筆記錄')
  clearTimeout(timer)
  ws.close()
  console.log('PASS：device A 寫入 → device B 經 WS 即時收到（雙裝置同步正常）')
  process.exit(0)
}

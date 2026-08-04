/**
 * 銀髮一句通 SilverCare Macau — Server 入口
 *
 * 單一 Node ESM 進程（埠 8787）：
 *  A. DeepSeek AI Proxy（密鑰安全邊界）— POST /api/ai/chat
 *  B. Local Sync Server（雙裝置 LAN 同步）— /sync/push、/sync/bootstrap、/sync/pull、WS /ws
 *
 * 安全原則：所有外部 API Key 僅以環境變數 (server/.env) 注入，
 * 絕不下發到前端、絕不寫入程式碼。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

// 以 index.mjs 相鄰的 .env 為準（不受啟動 cwd 影響）
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) })

import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import express from 'express'
import { WebSocketServer } from 'ws'
import assistRouter from './routes/assist.mjs'
import { createSyncRouter } from './sync/routes.mjs'
import { createHub } from './sync/hub.mjs'

const PORT = Number(process.env.PORT ?? 8787)

// ---- 同步配對 token（Warning 5：/sync/* 與 WS 最低限度鑑權）----
// 來自 env SYNC_TOKEN；未設定則自動生成並打印到啟動日誌（Demo 性質：
// 第二裝置經 URL ?syncToken=<token> 或 localStorage scv.syncToken 配對）。
const ENV_TOKEN = (process.env.SYNC_TOKEN ?? '').trim()
const SYNC_TOKEN = ENV_TOKEN || randomBytes(16).toString('hex')
if (!ENV_TOKEN) {
  console.log('[silvercare] SYNC_TOKEN 未設定，已自動生成（重啟會更換；固定請寫入 server/.env）')
}

/** 定時比較 token，避免時序側信道。 */
function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(SYNC_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** /sync/* 鑑權：Authorization: Bearer <token> 或 ?token=<token>。 */
function syncAuth(req, res, next) {
  const auth = req.headers.authorization
  const bearerOk = typeof auth === 'string' && auth.startsWith('Bearer ') && tokenMatches(auth.slice(7))
  const queryOk = typeof req.query.token === 'string' && tokenMatches(req.query.token)
  if (bearerOk || queryOk) return next()
  return res.status(401).json({ ok: false, error: 'unauthorized', message: '需要 SYNC_TOKEN（Authorization: Bearer <token> 或 ?token=）' })
}

const app = express()

// ---- CORS：僅允許 localhost / 127.0.0.1 開發來源 ----
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && DEV_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  return next()
})

app.use(express.json({ limit: '2mb' }))

// ---- Health check ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'silvercare-server', time: new Date().toISOString() })
})

// ---- AI 代理 ----
app.use('/api/ai', assistRouter)

// ---- HTTP + WebSocket server ----
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const hub = createHub(wss, { token: SYNC_TOKEN })

// ---- 同步路由（先鑑權；push 成功時經 hub 廣播給其他裝置）----
app.use('/sync', syncAuth, createSyncRouter(hub))

// ---- 404 / 錯誤處理（JSON）----
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }))
app.use((err, _req, res, _next) => {
  console.error('[server] error:', err)
  res.status(err?.status ?? 500).json({ ok: false, error: 'internal_error' })
})

server.listen(PORT, () => {
  console.log(`[silvercare] server listening on http://localhost:${PORT}`)
  console.log(`[silvercare] AI proxy: ${process.env.DEEPSEEK_API_KEY ? 'deepseek key loaded' : 'no DEEPSEEK_API_KEY → provider:local'}`)
  console.log(`[silvercare] SYNC_TOKEN=${SYNC_TOKEN}`)
  console.log('[silvercare] 第二裝置配對：瀏覽器開啟時加 ?syncToken=<上面 token>（詳見 server/README.md）')
})

// ---- 優雅關閉 ----
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    hub.close()
    wss.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}

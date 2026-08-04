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
import express from 'express'
import { WebSocketServer } from 'ws'
import assistRouter from './routes/assist.mjs'
import { createSyncRouter } from './sync/routes.mjs'
import { createHub } from './sync/hub.mjs'

const PORT = Number(process.env.PORT ?? 8787)

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
const hub = createHub(wss)

// ---- 同步路由（push 成功時經 hub 廣播給其他裝置）----
app.use('/sync', createSyncRouter(hub))

// ---- 404 / 錯誤處理（JSON）----
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }))
app.use((err, _req, res, _next) => {
  console.error('[server] error:', err)
  res.status(err?.status ?? 500).json({ ok: false, error: 'internal_error' })
})

server.listen(PORT, () => {
  console.log(`[silvercare] server listening on http://localhost:${PORT}`)
  console.log(`[silvercare] AI proxy: ${process.env.DEEPSEEK_API_KEY ? 'deepseek key loaded' : 'no DEEPSEEK_API_KEY → provider:local'}`)
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

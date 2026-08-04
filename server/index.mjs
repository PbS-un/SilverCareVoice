/**
 * 銀髮一句通 SilverCare Macau — Server 入口（佔位骨架）
 *
 * Express + WebSocket 於埠 8787。
 * 詳細路由（AI 代理、同步、WS 通訊）由後續任務在此擴展。
 *
 * 安全原則：所有外部 API Key 僅以環境變數 (.env) 注入 server，
 * 絕不下發到前端、絕不寫入程式碼。
 */
import 'dotenv/config'
import http from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 8787)

const app = express()
app.use(express.json())

// ---- Health check ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// ---- HTTP + WebSocket server ----
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    // 佔位 echo；正式訊息協議由後續任務定義
    socket.send(data.toString())
  })
})

server.listen(PORT, () => {
  console.log(`[silvercare] server listening on http://localhost:${PORT}`)
})

// ---- 優雅關閉 ----
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    wss.close()
    server.close(() => process.exit(0))
  })
}

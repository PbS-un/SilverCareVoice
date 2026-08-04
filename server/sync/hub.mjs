/**
 * 銀髮一句通 SilverCare Macau — WebSocket 同步中樞
 *
 * 協定（路徑 /ws）：
 *  客戶端 → { type:'hello', deviceId }          註冊裝置
 *  伺服器 → { type:'hello_ok', deviceId, serverTime }
 *  客戶端 → { type:'ping' }                     伺服器回 { type:'pong', serverTime }
 *  伺服器 → { type:'change', ops, originDeviceId }  其他裝置 push 成功後的廣播（排除來源裝置）
 *
 * 心跳：server 每 30s ping，無 pong 即 terminate。
 */
import { WebSocket } from 'ws'

export function createHub(wss, { heartbeatMs = 30_000 } = {}) {
  /** deviceId → Set<WebSocket> */
  const byDevice = new Map()
  /** WebSocket → deviceId */
  const deviceOf = new WeakMap()

  const send = (ws, obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  function register(ws, deviceId) {
    // 若此 socket 之前註冊過其他裝置，先移除
    const prev = deviceOf.get(ws)
    if (prev && prev !== deviceId) {
      byDevice.get(prev)?.delete(ws)
    }
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, new Set())
    byDevice.get(deviceId).add(ws)
    deviceOf.set(ws, deviceId)
  }

  function unregister(ws) {
    const deviceId = deviceOf.get(ws)
    if (!deviceId) return
    const set = byDevice.get(deviceId)
    if (set) {
      set.delete(ws)
      if (set.size === 0) byDevice.delete(deviceId)
    }
    deviceOf.delete(ws)
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        send(ws, { type: 'error', message: 'invalid_json' })
        return
      }
      if (msg?.type === 'hello' && typeof msg.deviceId === 'string' && msg.deviceId.trim()) {
        register(ws, msg.deviceId.trim())
        send(ws, { type: 'hello_ok', deviceId: msg.deviceId.trim(), serverTime: new Date().toISOString() })
      } else if (msg?.type === 'ping') {
        send(ws, { type: 'pong', serverTime: new Date().toISOString() })
      }
    })

    ws.on('close', () => unregister(ws))
    ws.on('error', () => unregister(ws))
  })

  // 心跳
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, heartbeatMs)
  timer.unref?.()

  /** 廣播 change 給所有已註冊裝置（排除來源裝置） */
  function broadcastChange(ops, originDeviceId) {
    const payload = JSON.stringify({ type: 'change', ops, originDeviceId })
    for (const [deviceId, sockets] of byDevice) {
      if (deviceId === originDeviceId) continue
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload)
      }
    }
  }

  function close() {
    clearInterval(timer)
    for (const ws of wss.clients) ws.close()
  }

  return {
    broadcastChange,
    deviceCount: () => byDevice.size,
    close,
  }
}

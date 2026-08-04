/**
 * 銀髮一句通 SilverCare Macau — 同步 HTTP 路由
 *
 * POST /sync/push        { deviceId, ops: [...] } → { applied, serverTime }，並 WS 廣播給其他裝置
 * GET  /sync/bootstrap   → { entities, serverTime }（首次加入用全部當前狀態）
 * GET  /sync/pull?since= → { ops, cursor, serverTime }（增量 ops）
 */
import { Router } from 'express'
import { z } from 'zod'
import { TABLE_WHITELIST, pushOps, bootstrapState, pullSince, serverNow } from './db.mjs'

const OpSchema = z.object({
  id: z.string().min(1).max(80),
  tbl: z.enum(TABLE_WHITELIST),
  entityId: z.string().min(1).max(80),
  updatedAt: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid ISO timestamp' }),
  type: z.enum(['put', 'del']),
  payload: z.record(z.any()).optional(),
})

const PushSchema = z.object({
  deviceId: z.string().min(1).max(80),
  ops: z.array(OpSchema).min(1).max(500),
})

/**
 * @param {{ broadcastChange: (ops: object[], originDeviceId: string) => void }} hub
 */
export function createSyncRouter(hub) {
  const router = Router()

  router.post('/push', (req, res) => {
    const parsed = PushSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_request',
        details: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      })
    }
    const { deviceId, ops } = parsed.data
    const applied = pushOps(deviceId, ops)
    if (applied > 0) {
      hub.broadcastChange(ops, deviceId)
    }
    return res.json({ applied, serverTime: serverNow() })
  })

  router.get('/bootstrap', (_req, res) => {
    res.json({ entities: bootstrapState(), serverTime: serverNow() })
  })

  router.get('/pull', (req, res) => {
    const since = String(req.query.since ?? '')
    if (!since || Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ ok: false, error: 'invalid_since', message: '需要 ?since=<合法 ISO 時間>' })
    }
    const { ops, cursor } = pullSince(since)
    return res.json({ ops, cursor, serverTime: serverNow() })
  })

  return router
}

/**
 * 銀髮一句通 SilverCare Macau — 同步 HTTP 路由
 *
 * 鑑權：所有 /sync/* 需先通過 SYNC_TOKEN 中間件（見 index.mjs）——
 * Authorization: Bearer <token> 或 ?token=<token>；未過關一律 401。
 *
 * POST /sync/push        { deviceId, ops: [...] }
 *   → { applied, rejected, duplicated, serverTime }
 *     applied/rejected/duplicated 為 op id 陣列：凡列入任一者，server 皆已收妥
 *     （rejected = 記入 ops 日誌但被 LWW 拒絕），客戶端可安全出隊。
 *   push 成功（至少一筆非重複）時經 WS 廣播給其他裝置。
 * GET  /sync/bootstrap   → { entities, cursor, serverTime }（首次加入用全部當前狀態；
 *   cursor = ops 日誌當前最大 seq，供後續 pull 起點）
 * GET  /sync/pull?since=<seq> → { ops, cursor, serverTime }
 *   since/cursor 為 server 端單調遞增 seq（數字字串），絕非客戶端時間；
 *   單頁上限 1000 筆，ops.length === 1000 時以回傳 cursor 續拉。
 */
import { Router } from 'express'
import { z } from 'zod'
import { TABLE_WHITELIST, pushOps, bootstrapState, pullSince, maxSeq, serverNow } from './db.mjs'

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

/** seq 游標：非負整數字串。 */
function parseSeqCursor(value) {
  const s = String(value ?? '')
  if (!/^\d{1,15}$/.test(s)) return null
  return Number(s)
}

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
    const { applied, rejected, duplicated } = pushOps(deviceId, ops)
    if (applied.length > 0) {
      hub.broadcastChange(ops, deviceId)
    }
    return res.json({ applied, rejected, duplicated, serverTime: serverNow() })
  })

  router.get('/bootstrap', (_req, res) => {
    res.json({ entities: bootstrapState(), cursor: String(maxSeq()), serverTime: serverNow() })
  })

  router.get('/pull', (req, res) => {
    const cursor = parseSeqCursor(req.query.since)
    if (cursor === null) {
      return res
        .status(400)
        .json({ ok: false, error: 'invalid_since', message: '需要 ?since=<seq 數字>（server 端單調序號，非時間）' })
    }
    const { ops, cursor: next } = pullSince(cursor)
    return res.json({ ops, cursor: next, serverTime: serverNow() })
  })

  return router
}

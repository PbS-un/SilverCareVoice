/**
 * 銀髮一句通 SilverCare Macau — AI 助理路由
 *
 * POST /api/ai/chat  body: { text: string, context?: object }
 * 回應統一為 { provider, reason?, analysis? }：
 *   provider: 'local' | 'safety' | 'deepseek' | 'fallback'
 */
import { Router } from 'express'
import { assist } from '../ai/deepseek.mjs'
import { ChatRequestSchema } from '../schemas/assistantResult.mjs'

const router = Router()

router.post('/chat', async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_request',
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }

  try {
    const result = await assist(parsed.data)
    return res.json(result)
  } catch (err) {
    // 未預期的錯誤：一律可降級，讓客戶端改用本地引擎
    console.error('[assist] unexpected error:', err)
    return res.status(502).json({
      provider: 'fallback',
      reason: 'provider_error',
      message: String(err?.message ?? err).slice(0, 300),
    })
  }
})

export default router

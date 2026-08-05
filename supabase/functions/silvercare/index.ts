/**
 * SilverCareVoice — Supabase Edge Function「silvercare」
 *
 * 1:1 移植本地 server（server/index.mjs、server/sync/*、server/ai/deepseek.mjs）
 * 的 HTTP 合約到 Supabase Deno Edge Runtime：
 *
 *   GET  /api/health            → { ok:true, service:'silvercare-cloud', time }
 *   POST /api/ai/chat           → { provider:'local'|'safety'|'deepseek'|'fallback', reason?, analysis? }
 *   POST /sync/push             → { applied, rejected, duplicated, serverTime }
 *   GET  /sync/bootstrap        → { entities, cursor, serverTime }
 *   GET  /sync/pull?since=<seq> → { ops, cursor, serverTime }
 *   其他                        → 404 { ok:false, error:'not_found' }
 *
 * ── npm 依賴導入方式 ──────────────────────────────────────────────────────
 * Deno Edge Runtime 原生支援 `npm:` 規範（無需 package.json / import map）：
 *   import { createClient } from 'npm:@supabase/supabase-js@^2'
 *   import { z } from 'npm:zod@^3'
 * `supabase functions serve` / deploy 會自動解析下載。zod 固定 v3（本项目
 * 的 schema 用 v3 API：z.record(z.any())、.partial().passthrough()）。
 *
 * ── 環境變數（Supabase Dashboard → Edge Functions Secrets）────────────────
 *   SUPABASE_URL —— 平台自動注入
 *   SUPABASE_SERVICE_ROLE_KEY（舊版密鑰體系）或
 *   SUPABASE_SECRET_KEY（新版密鑰體系）—— 平台自動注入其中之一；
 *     本函數兩者皆支援（前者优先），見 SERVICE_ROLE_KEY 常數處註釋
 *   SYNC_TOKEN          —— 必需；同步配對 token（亦用作 room 派生）
 *   DEEPSEEK_API_KEY    —— 可選；無 key → provider:'local'
 *   DEEPSEEK_BASE_URL   —— 可選；預設 https://api.deepseek.com
 *   DEEPSEEK_MODEL      —— 可選；預設 deepseek-chat
 *
 * ── 部署路徑說明 ─────────────────────────────────────────────────────────
 * 部署後可經兩種 URL 形態訪問：
 *  - https://<ref>.supabase.co/functions/v1/silvercare/<path>（專案網關）
 *  - https://<ref>.functions.supabase.co/silvercare/<path>（直連域名）
 * 本地 `supabase functions serve` 同帶 /functions/v1/silvercare 前綴。
 * 路由前先剝離上述任一前綴（見 routePath），使 /api/health 等合約路徑
 * 在各環境一致。
 *
 * ── Realtime 廣播 ────────────────────────────────────────────────────────
 * 依 Supabase 現行官方文件（Realtime → Broadcast using the REST API），
 * 批量廣播端點為 POST {SUPABASE_URL}/realtime/v1/api/broadcast，
 * body: { messages: [{ topic, event, payload }] }，標頭帶 apikey +
 * Authorization: Bearer <service_role>。
 * 注意 topic 必須帶 'realtime:' 前綴（'realtime:scv-sync-<room>'）：
 * 客戶端 supabase-js channel('scv-sync-<room>') 內部訂閱的 topic 即
 * 'realtime:scv-sync-<room>'，server 端廣播需與其逐字一致方能送達。
 * best-effort：失敗僅記日誌，不影響 push 回應。
 */

import { createClient } from 'npm:@supabase/supabase-js@^2.45.4'
import { z } from 'npm:zod@^3.23.8'

/* ══════════════════════════ 環境與常數 ══════════════════════════ */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
/**
 * service-role 等級密鑰，兩種密鑰體系皆支援：
 *  - 舊版：平台注入 SUPABASE_SERVICE_ROLE_KEY（對應 service_role key）
 *  - 新版：平台注入 SUPABASE_SECRET_KEY（sb_secret_... 前綴，
 *    對應舊版 service_role key 的角色）
 * 前者优先；亦可經 `supabase secrets set` 手動設定任一名稱。
 */
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? ''
const SYNC_TOKEN = (Deno.env.get('SYNC_TOKEN') ?? '').trim()

/** pull 單頁上限（與 server/sync/db.mjs PULL_PAGE_SIZE 一致）。 */
const PULL_PAGE_SIZE = 1000

/** 表名白名單（19 實體；與 server/sync/db.mjs TABLE_WHITELIST 逐字一致） */
const TABLE_WHITELIST = [
  'User',
  'ElderProfile',
  'Caregiver',
  'CaregiverLink',
  'ChronicCondition',
  'VitalRecord',
  'Medication',
  'MedicationLog',
  'SymptomRecord',
  'Appointment',
  'HealthEvent',
  'Alert',
  'CaregiverFollowUp',
  'Conversation',
  'ServiceQuery',
  'Consent',
  'AuditLog',
  'ResourceDirectory',
  'KnowledgeDocument',
] as const

/* ══════════════════════════ 通用工具 ══════════════════════════ */

const enc = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** room 隔離：SHA-256(SYNC_TOKEN) hex 前 16 字元（啟動時計算一次）。 */
const ROOM: Promise<string> | null = SYNC_TOKEN
  ? sha256Hex(SYNC_TOKEN).then((h) => h.slice(0, 16))
  : null

if (!SYNC_TOKEN) {
  console.error('[silvercare] SYNC_TOKEN 未設定 —— /sync/* 將回 500')
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  // 啟動即記日誌，方便在 Edge Function logs 定位配置問題；
  // 實際失敗行為維持不變：getSupabase() 於首次使用時 throw → /sync/* 回 500。
  console.error(
    '[silvercare] SUPABASE_URL 或 service-role 密鑰缺失（需 SUPABASE_SERVICE_ROLE_KEY ' +
      '或 SUPABASE_SECRET_KEY，視專案密鑰體系而定）—— /sync/* 將回 500',
  )
}

/**
 * 恆定時間字串比較（Deno 無 timingSafeEqual，自實現：先比長度再逐位元
 * XOR 累積，與 server/index.mjs tokenMatches 同語義）。
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a)
  const eb = enc.encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i += 1) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function tokenMatches(candidate: string | null | undefined): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || !SYNC_TOKEN) return false
  return timingSafeEqual(candidate, SYNC_TOKEN)
}

/** /sync/* 鑑權：Authorization: Bearer <token> 或 ?token=<token>。 */
function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get('authorization')
  const bearerOk = typeof auth === 'string' && auth.startsWith('Bearer ') && tokenMatches(auth.slice(7))
  const queryOk = tokenMatches(url.searchParams.get('token'))
  return bearerOk || queryOk
}

function serverNow(): string {
  return new Date().toISOString()
}

/* ══════════════════════════ CORS 與回應 ══════════════════════════ */

/** 與本地 server 相同的 dev 來源白名單（localhost / 127.0.0.1 任意埠）。 */
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
/** GitHub Pages 部署來源。 */
const PAGES_ORIGIN = 'https://pbs-un.github.io'

/**
 * 允許的請求標頭全集。
 *
 * 瀏覽器 CORS 預檢規則：非 CORS-safelisted 的自訂標頭必須被
 * Access-Control-Allow-Headers 明確放行，否則實際請求被攔截。
 * supabase-js 對每個請求自動附加 `apikey` 與 `Authorization` 標頭，
 * 因此雲端模式下所有 fetch（health/AI/sync）的預檢都會要求放行
 * `apikey` —— 舊版此處只回 'Content-Type, Authorization'，導致
 * 「Request header field apikey is not allowed by
 * Access-Control-Allow-Headers in preflight response」，前端全部
 * 雲端請求被擋而降級離線模式。
 *
 * 策略：預檢時優先回顯請求的 Access-Control-Request-Headers（對
 * 白名單 origin 而言沒有額外安全風險，且永遠覆蓋客戶端實際
 * 發送的標頭）；非預檢或缺失時退回明確全集，至少涵蓋：
 *   apikey, authorization, content-type, x-client-info,
 *   x-supabase-client, x-sync-token
 */
const ALLOWED_HEADERS =
  'apikey, authorization, content-type, x-client-info, x-supabase-client, x-sync-token'

function corsHeaders(req: Request): Headers {
  const h = new Headers()
  const origin = req.headers.get('origin')
  if (origin && (DEV_ORIGIN.test(origin) || origin === PAGES_ORIGIN)) {
    h.set('Access-Control-Allow-Origin', origin)
    h.set('Vary', 'Origin')
    h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    // 回顯預檢請求的標頭清單；非預檢請求則用明確全集（見上方註釋）
    const requested = req.headers.get('access-control-request-headers')
    h.set('Access-Control-Allow-Headers', requested && requested.trim() ? requested : ALLOWED_HEADERS)
    h.set('Access-Control-Max-Age', '86400')
  }
  return h
}

/** JSON 回應（所有響應——含 400/401/404/500——皆帶 CORS 頭）。 */
function jsonRes(req: Request, status: number, body: unknown): Response {
  const headers = corsHeaders(req)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}

const unauthorizedRes = (req: Request) =>
  jsonRes(req, 401, {
    ok: false,
    error: 'unauthorized',
    message: '需要 SYNC_TOKEN（Authorization: Bearer <token> 或 ?token=）',
  })

/* ══════════════════════════ Supabase client ══════════════════════════ */

let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或 SUPABASE_SECRET_KEY）未設定')
  }
  if (!_supabase) {
    // service-role client：bypasses RLS（兩 sync 表刻意不建 policy）
    _supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _supabase
}

/* ══════════════════════════ 同步核心（移植 db.mjs）══════════════════════════ */

type WireOp = {
  id: string
  tbl: string
  entityId: string
  updatedAt: string
  type: 'put' | 'del'
  payload?: Record<string, unknown>
}

/**
 * LWW 勝負判定（確定性，與客戶端 applyOps 同一規則）：
 * updatedAt 較新者勝；平手時 deviceId 字典序較大者勝。
 * （逐字複製 server/sync/db.mjs incomingWins）
 */
function incomingWins(
  opUpdatedAt: string,
  opDeviceId: string,
  curUpdatedAt: string,
  curDeviceId: string,
): boolean {
  if (opUpdatedAt > curUpdatedAt) return true
  if (opUpdatedAt < curUpdatedAt) return false
  return opDeviceId > curDeviceId
}

type EntityRef = { updatedAt: string; deviceId: string }
type EntityState = EntityRef & { payload: Record<string, unknown>; deleted: boolean }

/**
 * 應用一批 ops（對應 server/sync/db.mjs pushOps 的事務語義）：
 *  - 每筆 op 先插入 sync_ops 日誌（重複 id → ON CONFLICT DO NOTHING → duplicated，
 *    不覆蓋任何狀態）；
 *  - LWW 輸的 op 仍留在 sync_ops 日誌（供其他裝置 pull），但列 rejected；
 *  - applied = 覆蓋 sync_entities 當前狀態的 op id。
 *
 * 註：本地版是 SQLite 單進程事務；此處以「批次插入 + 讀取當前狀態 +
 * JS 內按序逐筆 LWW 判定 + 批次 upsert」重現同等結果（同一 push 內
 * 多筆同實體 op 依陣列順序串行判定，與本地逐筆事務一致）。極端併發
 * 下兩個 push 同時寫同一實體仍有理論競態，但 LWW 確定性規則保證客戶端
 * pull 後最終收斂（與分散式 op-log 設計一致）。
 */
async function pushOps(
  room: string,
  deviceId: string,
  ops: WireOp[],
): Promise<{ applied: string[]; rejected: string[]; duplicated: string[] }> {
  const supabase = getSupabase()
  const applied: string[] = []
  const rejected: string[] = []
  const duplicated: string[] = []

  // 1) 批次插入 ops 日誌；重複 id 被忽略（INSERT OR IGNORE 等价）
  const rows = ops.map((op) => ({
    id: op.id,
    room,
    device_id: deviceId,
    tbl: op.tbl,
    entity_id: op.entityId,
    updated_at: op.updatedAt,
    type: op.type,
    payload: op.payload ?? {},
  }))
  const { data: inserted, error: insErr } = await supabase
    .from('sync_ops')
    .insert(rows, { ignoreDuplicates: true })
    .select('id')
  if (insErr) throw new Error(`sync_ops insert failed: ${insErr.message}`)
  const insertedIds = new Set((inserted ?? []).map((r) => r.id as string))

  const nonDup = ops.filter((op) => {
    if (insertedIds.has(op.id)) return true
    duplicated.push(op.id) // 重複 op id，忽略
    return false
  })

  // 2) 讀取相關實體的當前 LWW 狀態（按 tbl 分組查詢）
  const idsByTbl = new Map<string, Set<string>>()
  for (const op of nonDup) {
    if (!idsByTbl.has(op.tbl)) idsByTbl.set(op.tbl, new Set())
    idsByTbl.get(op.tbl)!.add(op.entityId)
  }
  const current = new Map<string, EntityRef>()
  for (const [tbl, ids] of idsByTbl) {
    const { data, error } = await supabase
      .from('sync_entities')
      .select('entity_id, updated_at, device_id')
      .eq('room', room)
      .eq('tbl', tbl)
      .in('entity_id', [...ids])
    if (error) throw new Error(`sync_entities read failed: ${error.message}`)
    for (const r of data ?? []) {
      current.set(`${tbl}\u0000${r.entity_id}`, {
        updatedAt: (r.updated_at ?? '') as string,
        deviceId: (r.device_id ?? '') as string,
      })
    }
  }

  // 3) 按陣列順序逐筆 LWW 判定（同實體多筆 op 串行套用，等同本地事務）
  const finals = new Map<string, EntityState>()
  for (const op of nonDup) {
    const key = `${op.tbl}\u0000${op.entityId}`
    const cur = finals.get(key) ?? current.get(key)
    if (cur && !incomingWins(op.updatedAt, deviceId, cur.updatedAt, cur.deviceId)) {
      rejected.push(op.id) // LWW：較舊不覆蓋（op 仍在日誌，可供其他裝置 pull）
      continue
    }
    finals.set(key, {
      updatedAt: op.updatedAt,
      deviceId,
      payload: op.payload ?? {},
      deleted: op.type === 'del',
    })
    applied.push(op.id)
  }

  // 4) 批次 upsert 當前狀態
  if (finals.size > 0) {
    const upsertRows = [...finals.entries()].map(([key, v]) => {
      const sep = key.indexOf('\u0000')
      return {
        room,
        tbl: key.slice(0, sep),
        entity_id: key.slice(sep + 1),
        updated_at: v.updatedAt,
        payload: v.payload,
        deleted: v.deleted,
        device_id: v.deviceId,
      }
    })
    const { error } = await supabase
      .from('sync_entities')
      .upsert(upsertRows, { onConflict: 'room,tbl,entity_id' })
    if (error) throw new Error(`sync_entities upsert failed: ${error.message}`)
  }

  return { applied, rejected, duplicated }
}

/**
 * 全部當前狀態（首次加入裝置用；含 tombstone）。對應 bootstrapState。
 * 分頁讀取：Supabase PostgREST 預設 max-rows=1000 會靜默截斷無 limit 查詢，
 * 故以 .range(from, from+999) 迴圈分頁，直到回傳行數 < 1000 為止。
 */
async function bootstrapState(room: string) {
  const supabase = getSupabase()
  const PAGE = 1000
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sync_entities')
      .select('tbl, entity_id, updated_at, payload, deleted, device_id')
      .eq('room', room)
      .order('tbl', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`bootstrap read failed: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows.map((r) => ({
    tbl: r.tbl as string,
    entityId: r.entity_id as string,
    updatedAt: (r.updated_at ?? '') as string,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    deleted: Boolean(r.deleted),
    deviceId: (r.device_id ?? '') as string,
  }))
}

/**
 * 增量拉取：seq 嚴格大於 cursor 的 ops（單頁上限 PULL_PAGE_SIZE）。
 * 回傳 cursor = 本頁最大 seq（字串）；無新資料時回傳原 cursor。
 * （PostgREST 將 bigint 序列化為字串，此處轉回數字以維持線協議一致。）
 */
async function pullSince(room: string, cursor: number) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('sync_ops')
    .select('seq, id, device_id, tbl, entity_id, updated_at, type, payload')
    .eq('room', room)
    .gt('seq', cursor)
    .order('seq', { ascending: true })
    .limit(PULL_PAGE_SIZE)
  if (error) throw new Error(`pull read failed: ${error.message}`)
  const rows = data ?? []
  const ops = rows.map((r) => ({
    seq: Number(r.seq),
    id: r.id as string,
    deviceId: r.device_id as string,
    tbl: r.tbl as string,
    entityId: r.entity_id as string,
    updatedAt: r.updated_at as string,
    type: r.type as 'put' | 'del',
    payload: r.payload as Record<string, unknown>,
  }))
  return { ops, cursor: rows.length > 0 ? String(Number(rows[rows.length - 1].seq)) : String(cursor) }
}

/** ops 日誌當前最大 seq（該 room；空庫為 0）。對應 maxSeq。 */
async function maxSeq(room: string): Promise<number> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('sync_ops')
    .select('seq')
    .eq('room', room)
    .order('seq', { ascending: false })
    .limit(1)
  if (error) throw new Error(`maxSeq read failed: ${error.message}`)
  return data && data.length > 0 ? Number(data[0].seq) : 0
}

/* ══════════════════════════ Realtime 廣播 ══════════════════════════ */

/**
 * push 成功（applied.length > 0）時廣播 change 事件給其他裝置。
 * 對應本地 server 的 hub.broadcastChange —— 雲端版經 Supabase Realtime
 * REST 批量端點（官方文件格式，見檔首說明）：
 *   POST {SUPABASE_URL}/realtime/v1/api/broadcast
 *   body: { messages: [{ topic: 'realtime:scv-sync-<room>', event: 'change', payload }] }
 * topic 帶 'realtime:' 前綴：客戶端 supabase-js channel('scv-sync-<room>')
 * 內部訂閱的 topic 即 'realtime:scv-sync-<room>'，必須逐字一致。
 * best-effort：任何失敗僅記日誌，絕不影響 push 回應。
 */
async function broadcastChange(room: string, originDeviceId: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: `realtime:scv-sync-${room}`,
          event: 'change',
          payload: { originDeviceId },
        },
      ],
    }),
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`realtime broadcast http ${res.status}: ${detail.slice(0, 200)}`)
  }
}

/* ══════════════════════════ 同步路由 zod schemas ══════════════════════════ */

// 與 server/sync/routes.mjs OpSchema / PushSchema 逐字一致
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

/** seq 游標：非負整數字串（與 server/sync/routes.mjs parseSeqCursor 一致）。 */
function parseSeqCursor(value: string | null): number | null {
  const s = String(value ?? '')
  if (!/^\d{1,15}$/.test(s)) return null
  return Number(s)
}

/* ══════════════════════════ AI 助理（移植 deepseek.mjs）══════════════════════════ */

/** 高風險詞表（繁體中文／粵語）—— 與 server/ai/deepseek.mjs 逐字一致 */
const SAFETY_KEYWORDS = [
  '胸痛',
  '心口痛',
  '胸悶',
  '呼吸困難',
  '呼吸唔到',
  '暈倒',
  '昏迷',
  '失去意識',
  '跌倒起不來',
  '大量出血',
  '突然說話困難',
  '身體一邊無力',
]

/** Edge 環境超時收緊：首次 12s / 糾正重試 10s（本地版 15s）。 */
const TIMEOUT_FIRST_MS = 12_000
const TIMEOUT_RETRY_MS = 10_000

/** Server 側二次 safety 檢查（逐字移植 checkSafety）。 */
function checkSafety(text: string) {
  if (typeof text !== 'string' || !text) return null
  const hit = SAFETY_KEYWORDS.find((k) => text.includes(k))
  if (!hit) return null
  return {
    intent: 'emergency',
    riskLevel: 'urgent',
    answer: `你提到「${hit}」，呢個情況要特別小心。建議你而家坐低休息，即刻聯絡家人或者照顧者陪同協助。`,
    detailedAnswer:
      '如情況持續或加重，請立即致電緊急求助電話（澳門 999／120），並保持靜臥等待救援，唔好自行走动。',
    actions: ['即刻聯絡家人或照顧者', '坐低或瞓低休息', '情況持續即致電 999'],
  }
}

function envConfig() {
  return {
    apiKey: Deno.env.get('DEEPSEEK_API_KEY') ?? '',
    baseUrl: (Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: Deno.env.get('DEEPSEEK_MODEL') ?? 'deepseek-chat',
  }
}

const SYSTEM_PROMPT = `你是「銀髮一句通」的 AI 健康助理，服務澳門長者（粵語／繁體中文語境）。

## 硬性規則
1. 必須只輸出一個合法 JSON 物件，不得輸出任何其他文字、markdown 或代碼欄。
2. JSON 結構：{"intent": string, "riskLevel": string, "answer": string, "detailedAnswer"?: string, "extractedData"?: object, "actions"?: string[]}
3. intent 必須是以下 13 個值之一：symptom | vital_record | medication_taken | medication_missed | appointment_query | health_history | policy_query | medical_resource_query | family_contact | family_status_query | emergency | general_health_question | unknown
4. riskLevel 必須是：normal | attention | urgent
5. answer 必須用繁體中文（可用粵語口語），最多 2 句，語氣親切簡短，長者一聽就明。
6. extractedData 可選欄位：bloodPressure {systolic, diastolic}、bloodGlucose、heartRate、weight、symptoms[]、medicationName、medicationStatus ("taken"|"missed")；只填寫用戶明確提到的數值。
7. 涉及醫療判斷時只作一般建議，提醒用戶諮詢醫生；有即時危險才用 riskLevel "urgent"。

## 範例（few-shot）

用戶：「我今朝量血壓，上壓 138 下壓 85」
輸出：{"intent":"vital_record","riskLevel":"normal","answer":"收到，已為你記低今日血壓 138/85，數值大致正常，繼續保持。","extractedData":{"bloodPressure":{"systolic":138,"diastolic":85}}}

用戶：「我今日成日覺得頭暈，起身嗰陣特別暈」
輸出：{"intent":"symptom","riskLevel":"attention","answer":"頭暈可能有好多原因，建議你起身時慢啲、坐定先。如果持續或者加重，要睇醫生同通知家人。","extractedData":{"symptoms":["頭暈"]},"actions":["起身放慢","通知家人","持續不適睇醫生"]}

用戶：「澳門長者醫療券幾時可以先申請？」
輸出：{"intent":"policy_query","riskLevel":"normal","answer":"澳門醫療券一般每年下半年登記派發，詳情可以問衛生中心或者打 2856 1111 查詢。","detailedAnswer":"醫療券計劃由衛生局統籌，合資格長者會獲通知，可留意衛生局網頁或到就近衛生中心查詢。"}

現在請處理用戶的訊息。`

function buildMessages(text: string, context: Record<string, unknown> | undefined, correction?: string) {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]
  if (context && Object.keys(context).length > 0) {
    messages.push({
      role: 'system',
      content: `用戶背景資料（僅供理解，必須遵守上述輸出規則）：\n${JSON.stringify(context)}`,
    })
  }
  let user = text
  if (correction) {
    user += `\n\n注意：你上一次的輸出未能通過格式驗證（${correction}）。請嚴格按規則只輸出一個合法 JSON 物件。`
  }
  messages.push({ role: 'user', content: user })
  return messages
}

/** 容錯解析 LLM 回傳：剝離 markdown code fence 後 JSON.parse（逐字移植）。 */
function extractJson(content: string): unknown {
  let s = String(content).trim()
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s)
}

/** 調用 DeepSeek chat/completions；回傳解析後的 JSON（未驗證）。 */
async function callDeepseek(
  input: { text: string; context?: Record<string, unknown> },
  timeoutMs: number,
  correction?: string,
): Promise<unknown> {
  const { apiKey, baseUrl, model } = envConfig()
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: buildMessages(input.text, input.context, correction),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`deepseek http ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('deepseek empty content')
  return extractJson(content)
}

/* ── AI 輸出 zod schemas（移植 server/schemas/assistantResult.mjs）── */

const INTENTS = [
  'symptom',
  'vital_record',
  'medication_taken',
  'medication_missed',
  'appointment_query',
  'health_history',
  'policy_query',
  'medical_resource_query',
  'family_contact',
  'family_status_query',
  'emergency',
  'general_health_question',
  'unknown',
] as const

const RISK_LEVELS = ['normal', 'attention', 'urgent'] as const

const ExtractedDataSchema = z
  .object({
    bloodPressure: z
      .object({
        systolic: z.number().int().positive().optional(),
        diastolic: z.number().int().positive().optional(),
      })
      .partial()
      .optional(),
    bloodGlucose: z.number().positive().optional(),
    heartRate: z.number().positive().optional(),
    weight: z.number().positive().optional(),
    symptoms: z.array(z.string()).optional(),
    medicationName: z.string().optional(),
    medicationStatus: z.enum(['taken', 'missed']).optional(),
  })
  .partial()
  .passthrough()

const AssistantResultSchema = z.object({
  intent: z.enum(INTENTS),
  riskLevel: z.enum(RISK_LEVELS).default('normal'),
  answer: z.string().min(1),
  detailedAnswer: z.string().optional(),
  extractedData: ExtractedDataSchema.optional(),
  actions: z.array(z.string()).optional(),
})

const ChatRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  context: z.record(z.any()).optional(),
})

function zodErrorSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

/**
 * AI 助理主入口（逐字移植 assist）：
 *  1. 無 key → { provider:'local', reason:'no_key' }
 *  2. server 側 safety 檢查 → provider:'safety'
 *  3. DeepSeek + zod 驗證；失敗帶糾正提示重試一次（超時 12s/10s）
 *  4. 再失敗 → provider:'fallback'
 */
async function assist(input: {
  text: string
  context?: Record<string, unknown>
}): Promise<{ provider: string; reason?: string; message?: string; analysis?: unknown }> {
  if (!envConfig().apiKey) {
    return { provider: 'local', reason: 'no_key' }
  }

  const safety = checkSafety(input.text)
  if (safety) {
    return { provider: 'safety', analysis: safety }
  }

  let firstError = ''
  let transportError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callDeepseek(
        input,
        attempt === 0 ? TIMEOUT_FIRST_MS : TIMEOUT_RETRY_MS,
        attempt === 1 ? firstError : undefined,
      )
      const parsed = AssistantResultSchema.safeParse(raw)
      if (parsed.success) {
        return { provider: 'deepseek', analysis: parsed.data }
      }
      transportError = null
      firstError = zodErrorSummary(parsed.error)
    } catch (err) {
      transportError = err
      firstError = String((err as Error)?.message ?? err)
    }
  }

  if (transportError) {
    return {
      provider: 'fallback',
      reason: 'provider_error',
      message: firstError.slice(0, 300),
    }
  }
  return { provider: 'fallback', reason: 'invalid_output' }
}

/* ══════════════════════════ 請求處理 ══════════════════════════ */

/**
 * 讀取 JSON body（express.json({limit:'2mb'}) 等價）：
 *  - content-length 前置檢查：快速拒絕（保留，避免無謂讀取大 body）；
 *  - 讀入後再按實際長度強制一次：content-length 缺失的 chunked 請求
 *    會繞過前置檢查，必須在此兜底；
 *  - 空 body 視為 {}（與本地 express.json 將空請求解析為 {} 一致，
 *    交由 zod 走 details 路徑報缺失欄位）；
 *  - 失敗由呼叫方回本地 server 同款錯誤體（body-parser 設 err.status：
 *    JSON 解析失敗 400、超過 2mb 413，錯誤處理器統一
 *    {ok:false,error:'internal_error'}）。
 */
class BodyReadError extends Error {
  constructor(
    message: string,
    /** 對應本地 body-parser err.status。 */
    public status: number,
  ) {
    super(message)
  }
}

async function readJsonBody(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > 2 * 1024 * 1024) throw new BodyReadError('payload too large', 413)
  let text: string
  try {
    text = await req.text()
  } catch (err) {
    throw new BodyReadError(`body read failed: ${String((err as Error)?.message ?? err)}`, 400)
  }
  if (text.length > 2 * 1024 * 1024) throw new BodyReadError('payload too large', 413)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new BodyReadError('invalid JSON', 400)
  }
}

/** body 讀取／JSON 解析失敗回應：與本地 express 錯誤處理器逐字一致。 */
function bodyReadFailRes(req: Request, err: unknown): Response {
  const status = err instanceof BodyReadError ? err.status : 400
  return jsonRes(req, status, { ok: false, error: 'internal_error' })
}

async function handleAiChat(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return bodyReadFailRes(req, err)
  }
  const parsed = ChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonRes(req, 400, {
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
    return jsonRes(req, 200, result)
  } catch (err) {
    // 未預期的錯誤：一律可降級，讓客戶端改用本地引擎（同 server/routes/assist.mjs）
    console.error('[assist] unexpected error:', err)
    return jsonRes(req, 502, {
      provider: 'fallback',
      reason: 'provider_error',
      message: String((err as Error)?.message ?? err).slice(0, 300),
    })
  }
}

async function handleSyncPush(req: Request, room: string): Promise<Response> {
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return bodyReadFailRes(req, err)
  }
  const parsed = PushSchema.safeParse(body)
  if (!parsed.success) {
    return jsonRes(req, 400, {
      ok: false,
      error: 'invalid_request',
      details: parsed.error.issues.slice(0, 10).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  const { deviceId, ops } = parsed.data
  const { applied, rejected, duplicated } = await pushOps(room, deviceId, ops)
  if (applied.length > 0) {
    // best-effort 廣播：失敗僅記日誌，不影響 push 回應
    try {
      await broadcastChange(room, deviceId)
    } catch (err) {
      console.error('[sync] broadcast failed (ignored):', err)
    }
  }
  return jsonRes(req, 200, { applied, rejected, duplicated, serverTime: serverNow() })
}

async function handleSyncBootstrap(req: Request, room: string): Promise<Response> {
  const [entities, cursor] = await Promise.all([bootstrapState(room), maxSeq(room)])
  return jsonRes(req, 200, { entities, cursor: String(cursor), serverTime: serverNow() })
}

async function handleSyncPull(req: Request, url: URL, room: string): Promise<Response> {
  const cursor = parseSeqCursor(url.searchParams.get('since'))
  if (cursor === null) {
    return jsonRes(req, 400, {
      ok: false,
      error: 'invalid_since',
      message: '需要 ?since=<seq 數字>（server 端單調序號，非時間）',
    })
  }
  const { ops, cursor: next } = await pullSince(room, cursor)
  return jsonRes(req, 200, { ops, cursor: next, serverTime: serverNow() })
}

/* ══════════════════════════ Deno.serve 入口 ══════════════════════════ */

/**
 * 剝離部署前綴，使合約路徑在各環境一致。同時支援兩種掛載形態：
 *  - /functions/v1/silvercare —— supabase.co 網關與 `functions serve`
 *  - /silvercare —— 直連 https://<ref>.functions.supabase.co/silvercare
 */
function routePath(pathname: string): string {
  for (const prefix of ['/functions/v1/silvercare', '/silvercare']) {
    if (pathname === prefix) return '/'
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  }
  return pathname
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const path = routePath(url.pathname)

  // OPTIONS preflight → 204（與本地 server 一致，無論來源是否匹配）
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  try {
    // ---- Health check ----
    if (req.method === 'GET' && path === '/api/health') {
      return jsonRes(req, 200, { ok: true, service: 'silvercare-cloud', time: serverNow() })
    }

    // ---- AI 代理 ----
    if (req.method === 'POST' && path === '/api/ai/chat') {
      return await handleAiChat(req)
    }

    // ---- 同步路由（先鑑權）----
    if (path === '/sync/push' || path === '/sync/bootstrap' || path === '/sync/pull') {
      if (!SYNC_TOKEN || !ROOM) {
        return jsonRes(req, 500, { ok: false, error: 'internal_error' })
      }
      if (!isAuthorized(req, url)) return unauthorizedRes(req)
      const room = await ROOM
      if (req.method === 'POST' && path === '/sync/push') return await handleSyncPush(req, room)
      if (req.method === 'GET' && path === '/sync/bootstrap') return await handleSyncBootstrap(req, room)
      if (req.method === 'GET' && path === '/sync/pull') return await handleSyncPull(req, url, room)
    }

    // ---- 404（JSON，與本地 server 一致）----
    return jsonRes(req, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    console.error('[silvercare] error:', err)
    return jsonRes(req, 500, { ok: false, error: 'internal_error' })
  }
})

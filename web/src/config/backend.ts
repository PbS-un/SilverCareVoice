/**
 * SilverCare Voice — 後端位址配置（Task #2：可配置 Supabase 雲端後端）
 *
 * 兩種模式（構建時以 env 注入決定，runtime 不可切換）：
 *  - 本地模式（預設）：VITE_SUPABASE_URL 未設置 → 所有調用沿用硬編碼相對路徑
 *    （dev 經 vite.config.ts proxy 轉發 localhost:8787），行為與歷史版本逐字一致。
 *  - 雲端模式：VITE_SUPABASE_URL = Supabase Edge Function 完整 base URL
 *    （形如 https://<ref>.functions.supabase.co/silvercare）→ 各 URL 構造器
 *    回傳絕對位址，fetch 附 cloudHeaders()（apikey + Authorization: Bearer <anon>）。
 *
 * Sync token 傳遞（雲端）：Authorization 頭已由 anon key 佔用，sync token 改以
 * query `?token=<syncToken>` 附於 /sync/* 請求（實作見 wire.ts syncEndpoint）。
 * 選擇理由：本地 server 本就同時支援 `Authorization: Bearer` 與 `?token=`
 * （見 server/sync/routes.mjs 註釋），query 方案與本地協議一致且完全避開
 * Authorization 衝突。
 */

/**
 * Vite env 防禦式讀取：本檔會在純 Node 環境被載入（Playwright globalSetup →
 * wire.ts → 此檔，無 Vite 注入 → import.meta.env 為 undefined）。
 * 任何環境安全降級：缺失即視為空物件 → 本地模式。
 * （文件內所有 env 讀取——含 PROD 判斷——一律經此變數，絕不直接觸及
 * import.meta.env。）
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** 去除尾斜線的 base URL；未設置即空字串（本地模式）。 */
const BASE: string = ((env.VITE_SUPABASE_URL ?? '') as string).trim().replace(/\/+$/, '');
/** Supabase anon public key（公開層級，非機密）。 */
const ANON_KEY: string = ((env.VITE_SUPABASE_ANON_KEY ?? '') as string).trim();

/** 是否雲端模式（VITE_SUPABASE_URL 非空）。 */
export function isCloudMode(): boolean {
  return BASE.length > 0;
}

/** /api/health 位址（雲端 → `${base}/api/health`；本地 → '/api/health'）。 */
export function healthUrl(): string {
  return isCloudMode() ? `${BASE}/api/health` : '/api/health';
}

/** /api/ai/chat 位址（雲端 → `${base}/api/ai/chat`；本地 → '/api/ai/chat'）。 */
export function aiChatUrl(): string {
  return isCloudMode() ? `${BASE}/api/ai/chat` : '/api/ai/chat';
}

/**
 * /sync/* 位址：path 如 '/bootstrap'、'/pull?since=3'、'/push'
 * （雲端 → `${base}/sync${path}`；本地 → `/sync${path}`）。
 * 注意：雲端模式的 `?token=` 由 wire.ts syncEndpoint() 附加，本函式保持純粹。
 */
export function syncUrl(path: string): string {
  return isCloudMode() ? `${BASE}/sync${path}` : `/sync${path}`;
}

/** 雲端請求標頭（本地 → 空物件）：Edge Function 以 apikey 校驗 anon key。 */
export function cloudHeaders(): Record<string, string> {
  if (!isCloudMode()) return {};
  return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
}

/** anon key（供 Realtime createClient 使用；本地模式回傳空字串）。 */
export function anonKey(): string {
  return ANON_KEY;
}

/**
 * Supabase 項目根 URL（供 Realtime 連線）。推導規則：
 * `https://<ref>.functions.supabase.co[/...]` → `https://<ref>.supabase.co`；
 * 無法推導時（非標準 base 形態）可用 VITE_SUPABASE_PROJECT_URL 直接指定。
 */
export function realtimeUrl(): string {
  const explicit = ((env.VITE_SUPABASE_PROJECT_URL ?? '') as string).trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const m = BASE.match(/^https:\/\/([^.]+)\.functions\.supabase\.co/);
  return m ? `https://${m[1]}.supabase.co` : '';
}

// Production 構建卻未配置雲端 URL：醒目提示（本地模式於 dev 屬正常，不提示）。
// PROD 經防禦式 env 讀取：Vite 構建注入 boolean true；純 Node 環境 undefined → 不提示。
if (env.PROD && !isCloudMode()) {
  console.warn(
    '[backend] VITE_SUPABASE_URL 未設置：前端以本地模式運行（相對路徑經 dev proxy / 同域 server）。' +
      '如需連接 Supabase Edge Function，請於構建時注入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。',
  );
}

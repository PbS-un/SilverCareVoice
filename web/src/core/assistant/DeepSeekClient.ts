/**
 * DeepSeekClient —— Server AI Proxy（/api/ai/chat）客戶端（T5）
 *
 * 職責：
 * - probeProxy()：GET /api/health 探測 server 可達性（結果緩存、可失效重試）
 * - chatViaProxy()：POST /api/ai/chat，超時處理、riskLevel normalize
 *   （server 端可能回傳 'caution'，客戶端統一 normalize 成 'attention'）、
 *   用 web/src/types/ai.ts 嘅 zod schema 客戶端再驗證一次。
 * - 任何 network 錯誤／驗證失敗 → 回傳 null，由 AssistantService 降級本地引擎。
 *
 * 本檔案絕不載入任何 API Key —— 密鑰只存在 server 端。
 */
import {
  parseStructuredAnalysis,
  type RiskLevel,
  type StructuredAnalysis,
} from '../../types/ai';

/** 超時設定（毫秒） */
const PROBE_TIMEOUT_MS = 5_000;
const CHAT_TIMEOUT_MS = 30_000;

/** 探測結果緩存：成功 60 秒、失敗 10 秒（避免離線時每次 ask 都等 timeout） */
const PROBE_TTL_OK_MS = 60_000;
const PROBE_TTL_FAIL_MS = 10_000;

interface ProbeCache {
  reachable: boolean;
  at: number;
  ttl: number;
}

let probeCache: ProbeCache | null = null;

/** 測試／離線切換用：強制失效探測緩存。 */
export function invalidateProbeCache(): void {
  probeCache = null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探測 AI proxy 係咪可達。
 * 結果會緩存；傳 force=true 可強制重新探測（失效重試）。
 */
export async function probeProxy(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && probeCache && now - probeCache.at < probeCache.ttl) {
    return probeCache.reachable;
  }
  let reachable = false;
  try {
    const res = await fetchWithTimeout('/api/health', { method: 'GET' }, PROBE_TIMEOUT_MS);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      reachable = body === null || body.ok !== false;
    }
  } catch {
    reachable = false;
  }
  probeCache = {
    reachable,
    at: now,
    ttl: reachable ? PROBE_TTL_OK_MS : PROBE_TTL_FAIL_MS,
  };
  return reachable;
}

/** Server proxy 回應嘅形狀（只列客戶端關心嘅欄位）。 */
interface ProxyChatResponse {
  provider: 'local' | 'safety' | 'deepseek' | 'fallback';
  reason?: string;
  analysis?: unknown;
}

export interface ProxyChatResult {
  /** 應該用邊個來源嘅 analysis；null 代表要用本地引擎 */
  analysis: StructuredAnalysis | null;
  /** server 自報 provider（用於 AssistantResponse.provider） */
  provider: ProxyChatResponse['provider'];
}

/** riskLevel normalize：server 端可能回傳 'caution' → 客戶端一律 'attention' */
function normalizeRiskLevel(value: unknown): RiskLevel | undefined {
  if (value === 'caution') return 'attention';
  if (value === 'normal' || value === 'attention' || value === 'urgent') return value;
  return undefined;
}

/**
 * 將 server 回傳嘅 analysis 做輕量預處理，令佢符合客戶端 zod schema：
 * - riskLevel 'caution' → 'attention'
 * - actions 若為 string[]（server 契約）→ 轉為 { type, label }[]
 * - extractedData.bloodPressure 若唔齊上壓/下壓 → 丟棄該欄位
 * 預處理後仍唔合法 → 由呼叫方當驗證失敗處理。
 */
function normalizeServerAnalysis(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  const risk = normalizeRiskLevel(obj.riskLevel);
  if (risk !== undefined) obj.riskLevel = risk;

  if (Array.isArray(obj.actions)) {
    obj.actions = obj.actions.map((a) =>
      typeof a === 'string'
        ? { type: 'hint', label: a }
        : a,
    );
  }

  const extracted = obj.extractedData;
  if (typeof extracted === 'object' && extracted !== null) {
    const ex: Record<string, unknown> = { ...(extracted as Record<string, unknown>) };
    const bp = ex.bloodPressure;
    if (typeof bp === 'object' && bp !== null) {
      const { systolic, diastolic } = bp as { systolic?: unknown; diastolic?: unknown };
      if (typeof systolic !== 'number' || typeof diastolic !== 'number') {
        delete ex.bloodPressure;
      }
    }
    obj.extractedData = ex;
  }

  return obj;
}

/**
 * 調用 server AI proxy 分析一句輸入。
 *
 * 回傳：
 * - { analysis, provider }：server 比到可用 analysis（'safety' / 'deepseek'）
 * - { analysis: null, provider }：要用本地引擎（server 答 local/fallback、
 *   network 錯誤、超時、或 zod 驗證失敗）
 */
export async function chatViaProxy(
  text: string,
  context?: Record<string, unknown>,
): Promise<ProxyChatResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      '/api/ai/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(context ? { context } : {}) }),
      },
      CHAT_TIMEOUT_MS,
    );
  } catch {
    // network 錯誤／超時 → 降級本地引擎
    return { analysis: null, provider: 'fallback' };
  }

  if (!res.ok) {
    return { analysis: null, provider: 'fallback' };
  }

  let body: ProxyChatResponse;
  try {
    body = (await res.json()) as ProxyChatResponse;
  } catch {
    return { analysis: null, provider: 'fallback' };
  }

  const provider = body.provider ?? 'fallback';
  if (provider === 'local' || provider === 'fallback' || body.analysis == null) {
    return { analysis: null, provider };
  }

  // 客戶端用 zod schema 再驗證一次（信任邊界：server 輸出都唔直接落 DB／UI）
  const parsed = parseStructuredAnalysis(normalizeServerAnalysis(body.analysis));
  if (!parsed.success) {
    return { analysis: null, provider: 'fallback' };
  }
  return { analysis: parsed.data, provider };
}

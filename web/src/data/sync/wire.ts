/**
 * SilverCare Voice — Sync 層共用型別與工具（T8）
 *
 * Server 線協議（/sync/*、WS /ws）的 `tbl` 欄位使用「實體名」
 * （PascalCase，如 'VitalRecord'；見 server/sync/db.mjs TABLE_WHITELIST），
 * 而本地 Dexie 使用 store 名（camelCase，如 'vitalRecords'）。
 * 本檔提供兩者的雙向映射與同步層通用 helper。
 */

import { TABLE_NAMES, type EntityName, type TableName } from '../../types/entities';
import { cloudHeaders, healthUrl, isCloudMode, syncUrl } from '../../config/backend';

/** 線協議上的一筆操作（push / pull / WS change 共用）。 */
export interface WireOp {
  /** 操作唯一 ID（uuid；server 以此去重）。 */
  id: string;
  /** 實體名（server 白名單，PascalCase，如 'VitalRecord'）。 */
  tbl: string;
  /** 實體主鍵。 */
  entityId: string;
  /** ISO-8601；僅供 LWW 比較（絕不作 pull 游標——游標是 server 端 seq）。 */
  updatedAt: string;
  /** put = 寫入（帶 payload）；del = 刪除（tombstone）。 */
  type: 'put' | 'del';
  /** 完整實體 JSON（put 時必帶）。 */
  payload?: Record<string, unknown>;
  /** 來源裝置（pull / bootstrap 回傳；LWW 平手 tiebreaker 用）。 */
  deviceId?: string;
  /** server 端單調序號（pull 回傳；即游標语义）。 */
  seq?: number;
}

/** bootstrap 回傳的一筆當前狀態（含 tombstone）。 */
export interface BootstrapEntity {
  tbl: string;
  entityId: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  /** 最後寫入裝置（LWW 平手 tiebreaker 用）。 */
  deviceId?: string;
}

/** push 回應（server 對每筆 op 的應用結果）。 */
export interface PushResult {
  /** 覆蓋當前狀態的 op id。 */
  applied?: string[];
  /** 記入 ops 日誌但被 LWW 拒絕的 op id（server 已收妥，可出隊但需 warn）。 */
  rejected?: string[];
  /** 重複推送（日誌已有）的 op id。 */
  duplicated?: string[];
  serverTime?: string;
}

/** 本地 Dexie 表名 → 線協議實體名。 */
export const TABLE_TO_ENTITY: Record<TableName, EntityName> = (() => {
  const m = {} as Record<TableName, EntityName>;
  for (const [entity, table] of Object.entries(TABLE_NAMES)) {
    m[table as TableName] = entity as EntityName;
  }
  return m;
})();

/** 線協議實體名 → 本地 Dexie 表名（未知名稱回傳 undefined）。 */
export function tableOfEntity(tbl: string): TableName | undefined {
  return (TABLE_NAMES as Record<string, string>)[tbl] as TableName | undefined;
}

/** localStorage 鍵名。 */
export const LS_DEVICE_ID = 'scv.deviceId';
/** pull 游標：server 端單調 seq（數字字串，非時間）。 */
export const LS_SYNC_CURSOR = 'scv.syncCursor';
/** 同步配對 token（server SYNC_TOKEN）。 */
export const LS_SYNC_TOKEN = 'scv.syncToken';

/**
 * 取得同步配對 token：localStorage 優先；首次配對可由 URL `?syncToken=<token>`
 * 帶入（自動持久化，第二裝置只需帶一次）。無 token 回傳空字串。
 */
export function getSyncToken(storage: Storage = localStorage): string {
  try {
    const existing = storage.getItem(LS_SYNC_TOKEN);
    if (existing) return existing;
    if (typeof location !== 'undefined' && location.search) {
      const fromUrl = new URLSearchParams(location.search).get('syncToken');
      if (fromUrl) {
        storage.setItem(LS_SYNC_TOKEN, fromUrl);
        return fromUrl;
      }
    }
  } catch {
    // ignore（無 localStorage 環境）
  }
  return '';
}

/** /sync/* 請求的鑑權標頭（無 token 時為空物件——server 將回 401）。 */
export function authHeaders(): Record<string, string> {
  const token = getSyncToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 產生操作 ID（uuid；舊環境降級為隨機字串）。 */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 取得（或首次建立）本裝置唯一 ID，持久化於 localStorage。 */
export function getOrCreateDeviceId(storage: Storage = localStorage): string {
  let id = storage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = `dev-${newId()}`;
    storage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

/**
 * 帶超時的 fetch。超時／網路錯誤一律 reject（由呼叫方決定降級策略）。
 * 不依賴 AbortSignal.timeout（jsdom / 舊瀏覽器支援不一）。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 2000,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  // bind(globalThis)：fetch 經變數轉手後以裸引用調用會丟失 receiver，
  // 在部分瀏覽器觸發 "Illegal invocation"（雲端模式 outbox push 因此從未發出）。
  const doFetch = (fetchImpl ?? fetch).bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探測 server 是否可達（GET /api/health）。絕不 throw。
 * 本地模式：短超時 2000ms、不重試（歷史行為逐字不變）。
 * 雲端模式：首次 5000ms（Edge Function 冷啟動）、重試收緊到 3000ms，
 * 將啟動最壞等待（5s + 3s = 8s）壓低（原 5s + 5s）。
 */
export async function probeServer(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (isCloudMode()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const timeoutMs = attempt === 0 ? 5000 : 3000;
        const res = await fetchWithTimeout(healthUrl(), { headers: { ...cloudHeaders() } }, timeoutMs, fetchImpl);
        if (res.ok) return true;
      } catch {
        // 超時／網路錯誤：雲端模式重試一次，否則直接 false
      }
    }
    return false;
  }
  try {
    const res = await fetchWithTimeout('/api/health', {}, 2000, fetchImpl);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * /sync/* 請求完整 URL（path 如 '/bootstrap'、'/pull?since=3'、'/push'）。
 * 本地模式：'/sync' + path（歷史行為逐字不變）。
 * 雲端模式：syncUrl(path) 並以 query `?token=<syncToken>` 附帶配對 token ——
 * Authorization 頭已由 anon key（cloudHeaders）佔用，query 方案與本地 server
 * 的 `?token=` 支援一致（見 server/sync/routes.mjs），且避開 Authorization 衝突。
 */
export function syncEndpoint(path: string): string {
  const url = syncUrl(path);
  if (!isCloudMode()) return url;
  const token = getSyncToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/**
 * /sync/* 請求鑑權標頭。
 * 本地模式：authHeaders()（Authorization: Bearer <syncToken>），歷史行為不變。
 * 雲端模式：cloudHeaders()（apikey + Authorization: Bearer <anon>）——
 * sync token 不走 Authorization（已由 anon key 佔用），改由 syncEndpoint 的 query 附帶。
 */
export function syncAuthHeaders(): Record<string, string> {
  return isCloudMode() ? cloudHeaders() : authHeaders();
}

/** 依目前頁面 host 構造 WS URL（開發時經 Vite proxy 轉發）。 */
export function wsUrl(loc: { protocol: string; host: string } = location): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}/ws`;
}

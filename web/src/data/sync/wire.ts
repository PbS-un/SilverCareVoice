/**
 * SilverCare Voice — Sync 層共用型別與工具（T8）
 *
 * Server 線協議（/sync/*、WS /ws）的 `tbl` 欄位使用「實體名」
 * （PascalCase，如 'VitalRecord'；見 server/sync/db.mjs TABLE_WHITELIST），
 * 而本地 Dexie 使用 store 名（camelCase，如 'vitalRecords'）。
 * 本檔提供兩者的雙向映射與同步層通用 helper。
 */

import { TABLE_NAMES, type EntityName, type TableName } from '../../types/entities';

/** 線協議上的一筆操作（push / pull / WS change 共用）。 */
export interface WireOp {
  /** 操作唯一 ID（uuid；server 以此去重）。 */
  id: string;
  /** 實體名（server 白名單，PascalCase，如 'VitalRecord'）。 */
  tbl: string;
  /** 實體主鍵。 */
  entityId: string;
  /** ISO-8601；LWW 依據。 */
  updatedAt: string;
  /** put = 寫入（帶 payload）；del = 刪除（tombstone）。 */
  type: 'put' | 'del';
  /** 完整實體 JSON（put 時必帶）。 */
  payload?: Record<string, unknown>;
}

/** bootstrap 回傳的一筆當前狀態（含 tombstone）。 */
export interface BootstrapEntity {
  tbl: string;
  entityId: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  deleted: boolean;
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
export const LS_SYNC_CURSOR = 'scv.syncCursor';

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
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 探測 server 是否可達（GET /api/health，短超時）。絕不 throw。 */
export async function probeServer(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('/api/health', {}, 2000, fetchImpl);
    return res.ok;
  } catch {
    return false;
  }
}

/** 依目前頁面 host 構造 WS URL（開發時經 Vite proxy 轉發）。 */
export function wsUrl(loc: { protocol: string; host: string } = location): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}/ws`;
}

/**
 * SilverCare Voice — Sync 客戶端（T8：local-first 雙裝置同步）
 *
 * 職責：
 *  - 啟動：bootstrap 全量（首次）或 pull?since=cursor（續接），LWW apply 到 IndexedDB
 *  - WS /ws：hello（帶 SYNC_TOKEN）註冊裝置；收 change → apply ops → 觸發 provider.subscribe
 *  - 斷線指數退避重連（1s → 30s 封頂）；回前台（visibilitychange）pull 補漏
 *  - cursor / lastSyncAt 持久化於 localStorage
 *
 * 游標語義（Critical 修復）：cursor 是 server 端單調遞增 seq（數字字串），
 * 絕非客戶端 updatedAt —— 離線／慢時鐘裝置的 op 不會因時間游標被永久遺漏。
 * 舊版 ISO 時間游標一經偵測即丟棄並改走 bootstrap。
 *
 * 鑑權：/sync/* 與 WS hello 需 SYNC_TOKEN（localStorage `scv.syncToken`
 * 或 URL `?syncToken=` 配對）；401 / auth_error 時停止重試並提示。
 *
 * 遠端變更一律直接寫入底層 IndexedDBProvider（繞過 Outbox，避免循環推送）。
 */

import type { IndexedDBProvider } from '../IndexedDBProvider';
import type { BulkEntry } from '../DataProvider';
import type { TableName, BaseEntity } from '../../types/entities';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'; // 僅 type（runtime 動態 import）
import { anonKey, isCloudMode, realtimeUrl } from '../../config/backend';
import {
  LS_SYNC_CURSOR,
  fetchWithTimeout,
  getSyncToken,
  syncAuthHeaders,
  syncEndpoint,
  tableOfEntity,
  wsUrl,
  type BootstrapEntity,
  type WireOp,
} from './wire';

/** server pull 單頁上限（與 server/sync/db.mjs PULL_PAGE_SIZE 一致）。 */
const PULL_PAGE_SIZE = 1000;
/** 續拉安全上限（50 頁 = 5 萬筆 op，demo 規模綽綽有餘）。 */
const PULL_MAX_PAGES = 50;

export interface SyncClientOptions {
  /** 可注入 fetch（測試用）。 */
  fetchImpl?: typeof fetch;
  /** WS 握手成功（hello_ok）後回調 —— 用於觸發 Outbox flush。 */
  onConnected?: () => void;
  /** WS URL 覆蓋（預設依 location.host 構造）。 */
  wsUrlFactory?: () => string;
}

/** 重連退避：1s、2s、4s …… 30s 封頂。 */
function backoffDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * 雲端 Realtime 頻道 room：SHA-256(syncToken) hex 前 16 字元（Web Crypto）。
 * 必須與 Task #1 Edge Function 的頻道命名一致（頻道名 scv-sync-<room>）。
 */
export async function cloudRoomId(syncToken: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(syncToken));
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

/** 本地實體上記錄的最後寫入裝置欄位（LWW 平手 tiebreaker 用）。 */
const WRITER_FIELD = '_writerDeviceId';

export class SyncClient {
  private inner: IndexedDBProvider;
  private deviceId: string;
  private fetchImpl: typeof fetch;
  private onConnected?: () => void;
  private wsUrlFactory: () => string;

  private ws: WebSocket | null = null;
  private stopped = false;
  private unauthorized = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  /** 雲端模式變更通知（本地模式恒為 null）。 */
  private supabase: SupabaseClient | null = null;
  private cloudChannel: RealtimeChannel | null = null;
  private cloudCatchUpTimer: ReturnType<typeof setInterval> | null = null;
  /** catchUp 去重：進行中時不併發重入（Realtime 事件與 3s 兜底 interval 共用）。 */
  private catchUpInFlight = false;

  constructor(inner: IndexedDBProvider, deviceId: string, opts: SyncClientOptions = {}) {
    this.inner = inner;
    this.deviceId = deviceId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onConnected = opts.onConnected;
    this.wsUrlFactory = opts.wsUrlFactory ?? wsUrl;
  }

  /* ────────────────────────────── 啟動 ────────────────────────────── */

  /**
   * 啟動同步：先補資料（bootstrap / pull），再開 WS。
   * 各階段失敗只記錄、不拋出 —— 絕不阻塞 App。
   */
  async start(): Promise<void> {
    try {
      if (this.readCursor()) {
        await this.pull(); // 續接：增量補漏
      } else {
        await this.bootstrap(); // 首次加入：全量
      }
    } catch {
      // 拉取失敗仍可繼續（WS 連線後 / 回前台時會再補）
    }
    if (isCloudMode()) {
      void this.connectCloud(); // 雲端：Realtime broadcast + 3s 兜底（不用 WS）
    } else {
      this.connect(); // 本地：WS /ws（代碼路徑逐字不變）
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /** 停止：關 WS／雲端頻道、清計時器、解除監聽。 */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    // 雲端模式清理：3s 兜底 interval 與 Realtime 頻道／client
    if (this.cloudCatchUpTimer !== null) {
      clearInterval(this.cloudCatchUpTimer);
      this.cloudCatchUpTimer = null;
    }
    const channel = this.cloudChannel;
    this.cloudChannel = null;
    if (channel) {
      try {
        void channel.unsubscribe();
      } catch {
        // ignore
      }
    }
    if (this.supabase) {
      try {
        void this.supabase.removeAllChannels();
      } catch {
        // ignore
      }
      this.supabase = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  /* ────────────────────────────── 補資料 ────────────────────────────── */

  /**
   * 帶鑑權的 sync fetch（path 如 '/bootstrap'、'/pull?since=3'）。
   * 本地：'/sync'+path 與 Authorization: Bearer <syncToken>（歷史行為不變）。
   * 雲端：syncUrl + `?token=<syncToken>` query 與 anon apikey 標頭（syncEndpoint / syncAuthHeaders）。
   */
  private authFetch(path: string, timeoutMs = 10_000): Promise<Response> {
    return fetchWithTimeout(syncEndpoint(path), { headers: { ...syncAuthHeaders() } }, timeoutMs, this.fetchImpl);
  }

  /** 401 處理：標記未授權並提示配對方式（不再盲目重試）。 */
  private markUnauthorized(what: string): void {
    if (!this.unauthorized) {
      this.unauthorized = true;
      console.warn(
        `[sync] ${what} 回 401：缺少或錯誤的 SYNC_TOKEN。請以 URL ?syncToken=<token> 重新開啟頁面配對（token 見 server 啟動日誌）。`,
      );
    }
  }

  /** 首次加入：GET /sync/bootstrap 全量拉取並 LWW apply；cursor 取回傳 seq。 */
  async bootstrap(): Promise<void> {
    const res = await this.authFetch('/bootstrap');
    if (res.status === 401) {
      this.markUnauthorized('bootstrap');
      throw new Error('bootstrap failed: HTTP 401 (unauthorized)');
    }
    if (!res.ok) throw new Error(`bootstrap failed: HTTP ${res.status}`);
    const body = (await res.json()) as { entities: BootstrapEntity[]; cursor?: string; serverTime: string };
    await this.applyOps(
      body.entities.map((e) => ({
        id: `boot-${e.tbl}-${e.entityId}`,
        tbl: e.tbl,
        entityId: e.entityId,
        updatedAt: e.updatedAt,
        type: e.deleted ? 'del' : 'put',
        payload: e.payload,
        deviceId: e.deviceId ?? '',
      })),
    );
    if (typeof body.cursor === 'string' && /^\d+$/.test(body.cursor)) {
      this.writeCursor(body.cursor);
    }
  }

  /**
   * 增量：GET /sync/pull?since=<seq cursor>，apply 後推進 cursor。
   * 單頁 1000 筆，滿頁即以新 cursor 續拉（分頁）。
   */
  async pull(): Promise<void> {
    let since: string = this.readCursor() ?? '';
    if (!since) return this.bootstrap();
    for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
      const res = await this.authFetch(`/pull?since=${encodeURIComponent(since)}`);
      if (res.status === 401) {
        this.markUnauthorized('pull');
        throw new Error('pull failed: HTTP 401 (unauthorized)');
      }
      if (!res.ok) throw new Error(`pull failed: HTTP ${res.status}`);
      const body = (await res.json()) as { ops: WireOp[]; cursor: string; serverTime: string };
      await this.applyOps(body.ops ?? []);
      const next = String(body.cursor ?? since);
      this.writeCursor(next);
      if (!body.ops || body.ops.length < PULL_PAGE_SIZE) return;
      since = next;
    }
  }

  /** 回前台補漏（visibilitychange）。 */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    void this.catchUp();
  };

  /** 補漏：有 cursor 走 pull，否則重新 bootstrap。失敗靜默（下輪再試）。 */
  async catchUp(): Promise<void> {
    if (this.unauthorized) return;
    try {
      if (this.readCursor()) await this.pull();
      else await this.bootstrap();
    } catch {
      // ignore —— 不回 throw，避免阻塞 UI
    }
  }

  /* ──────────────────────── 雲端變更通知 ──────────────────────── */

  /**
   * catchUp 去重包裝：進行中不併發重入（Realtime 'change' 事件與
   * 3s 兜底 interval 可能同時觸發）。
   */
  private async catchUpOnce(): Promise<void> {
    if (this.catchUpInFlight) return;
    this.catchUpInFlight = true;
    try {
      await this.catchUp();
    } finally {
      this.catchUpInFlight = false;
    }
  }

  /**
   * 雲端模式變更通知（取代 WS，本地 WS 路徑絕不進入本函式）：
   *  (a) @supabase/supabase-js Realtime broadcast 頻道 `scv-sync-<room>`
   *      （room = SHA-256(syncToken) hex 前 16 字元，與 Task #1 Edge Function
   *      發布端一致）訂閱 'change' 事件 → catchUp；
   *  (b) 3 秒 setInterval 兜底 catchUp（Realtime 斷線也不漏變更）。
   *
   * supabase-js 採動態 import：本地模式 bundle 完全不含該依賴。
   * 任何失敗只記錄不拋出 —— 兜底 interval 與回前台 pull 仍保證最終一致。
   */
  private async connectCloud(): Promise<void> {
    if (this.stopped || this.unauthorized) return;
    const token = getSyncToken();
    if (!token) {
      // 未配對訪客（無 syncToken）：不建 Realtime 頻道、不啟動 3 秒兜底輪詢，
      // 避免無意義的 401 請求風暴；已配對路徑不變（頻道 + 3 秒兜底）。
      return;
    }
    try {
      const room = await cloudRoomId(token);
      if (this.stopped) return;
      const projectUrl = realtimeUrl();
      if (projectUrl) {
        const { createClient } = await import('@supabase/supabase-js');
        if (this.stopped) return;
        const client = createClient(projectUrl, anonKey(), {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        this.supabase = client;
        const channel = client.channel(`scv-sync-${room}`);
        channel.on('broadcast', { event: 'change' }, () => {
          void this.catchUpOnce();
        });
        await channel.subscribe();
        if (this.stopped) return;
        this.cloudChannel = channel;
      } else {
        console.warn('[sync] 雲端模式：無法推導 Supabase 項目 URL，僅以 3s 兜底 interval 補漏');
      }
      this.onConnected?.(); // 觸發 Outbox flush（對齊 WS hello_ok 行為）
    } catch {
      // Realtime 建立失敗：3s 兜底 interval 仍持續運作
    }
    if (this.stopped) return;
    if (this.cloudCatchUpTimer === null) {
      this.cloudCatchUpTimer = setInterval(() => {
        void this.catchUpOnce();
      }, 3000);
    }
  }

  /* ────────────────────────────── WebSocket ────────────────────────────── */

  private connect(): void {
    if (this.stopped || this.unauthorized) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrlFactory());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: 'hello', deviceId: this.deviceId, token: getSyncToken() }));
      } catch {
        // ignore
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; ops?: WireOp[]; originDeviceId?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'hello_ok') {
        this.attempt = 0;
        this.startKeepalive(ws);
        this.onConnected?.();
        // 連線期間可能漏掉的變更，用 pull 補一次
        void this.catchUp();
      } else if (msg.type === 'auth_error') {
        this.markUnauthorized('WS hello');
        try {
          ws.close();
        } catch {
          // ignore
        }
      } else if (msg.type === 'change' && Array.isArray(msg.ops)) {
        void this.applyOps(msg.ops, msg.originDeviceId ?? '');
      }
      // pong：不需處理
    };

    ws.onclose = () => this.handleDrop();
    ws.onerror = () => {
      // onclose 會隨之觸發；此處只確保計時器存在
    };
  }

  private handleDrop(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.ws = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.unauthorized || this.reconnectTimer !== null) return;
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 每 25s 發 JSON ping 保活（server 每 30s 偵測）。 */
  private startKeepalive(ws: WebSocket): void {
    if (this.keepaliveTimer !== null) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // ignore
      }
    }, 25_000);
  }

  /* ────────────────────────────── LWW apply ────────────────────────────── */

  /**
   * 把一批遠端 ops apply 到本地。LWW 規則與 server pushOps 完全一致：
   *  - updatedAt 較新者勝；
   *  - 平手時比較「最後寫入裝置」deviceId 字典序，較大者勝（確定性
   *    tiebreaker → 同毫秒雙寫在 server 與兩端收斂同一結果，不分叉）。
   * 本地實體以 `_writerDeviceId` 欄位記錄最後寫入裝置（缺省視為本裝置）。
   *
   * 寫入直接走底層 IndexedDBProvider —— 其 bulkPut / remove 會 emit，
   * 從而觸發 provider.subscribe，UI 自動刷新。
   *
   * @param ops 遠端 ops（pull 回傳自帶 deviceId；change 批次用 fallbackDeviceId）
   * @param fallbackDeviceId change 訊息的 originDeviceId
   */
  async applyOps(ops: WireOp[], fallbackDeviceId = ''): Promise<void> {
    const puts: BulkEntry[] = [];
    const dels: { table: TableName; id: string }[] = [];

    for (const op of ops ?? []) {
      const table = tableOfEntity(op.tbl);
      if (!table || !op.entityId || !op.updatedAt) continue;
      const writer = op.deviceId ?? fallbackDeviceId;
      const existing = await this.inner.get<BaseEntity>(table, op.entityId);
      if (existing) {
        const localWriter =
          ((existing as unknown as Record<string, unknown>)[WRITER_FIELD] as string | undefined) ??
          this.deviceId;
        const wins =
          op.updatedAt > existing.updatedAt ||
          (op.updatedAt === existing.updatedAt && writer > localWriter);
        if (!wins) continue; // 本地較新（或平手且本地裝置序較大）→ 保留本地
      }
      if (op.type === 'del') {
        dels.push({ table, id: op.entityId });
      } else {
        puts.push({
          table,
          entity: {
            ...(op.payload ?? {}),
            id: op.entityId,
            updatedAt: op.updatedAt,
            [WRITER_FIELD]: writer,
          } as unknown as BaseEntity,
        });
      }
    }

    if (puts.length > 0) await this.inner.bulkPut(puts);
    for (const d of dels) await this.inner.remove(d.table, d.id);
  }

  /* ────────────────────────────── cursor ────────────────────────────── */

  /**
   * 讀取 pull 游標（server seq，數字字串）。舊版 ISO 時間游標不相容 ——
   * 偵測即丟棄（回 null → 走 bootstrap 重建），避免誤當 seq 解析。
   */
  private readCursor(): string | null {
    try {
      const v = localStorage.getItem(LS_SYNC_CURSOR);
      if (v === null) return null;
      if (/^\d+$/.test(v)) return v;
      localStorage.removeItem(LS_SYNC_CURSOR);
      return null;
    } catch {
      return null;
    }
  }

  private writeCursor(cursor: string): void {
    try {
      localStorage.setItem(LS_SYNC_CURSOR, cursor);
      localStorage.setItem('scv.lastSyncAt', new Date().toISOString());
    } catch {
      // ignore
    }
  }
}

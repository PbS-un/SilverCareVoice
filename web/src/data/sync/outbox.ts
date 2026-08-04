/**
 * SilverCare Voice — Outbox 寫入複製與同步包裝 Provider（T8）
 *
 * Local-first 寫入路徑：
 *   UI/AssistantService → SyncedProvider.put/bulkPut/remove/reset
 *     1. 先寫本地 IndexedDB（UI 即時可見、subscribe 即時觸發）
 *     2. 同時把對應 op 推入 Outbox（持久化於獨立 IndexedDB store，刷新不丟）
 *     3. Outbox debounce ~200ms 後批量 POST /sync/push；成功出隊、失敗指數退避重試
 *
 * standalone（server 不可達）時 Outbox 為 null，行為與純 IndexedDB 完全一致 ——
 * 上層單一 code path，無 build flag、無 demo-only 分支。
 */

import Dexie, { type Table } from 'dexie';
import { TABLE_NAME_LIST, type BaseEntity, type TableName, type VitalRecord, type VitalType } from '../../types/entities';
import { IndexedDBProvider } from '../IndexedDBProvider';
import type { BulkEntry, DataProvider, ListFilter, SeedData, SubscribeCallback, Unsubscribe } from '../DataProvider';
import { SyncClient } from './SyncClient';
import { TABLE_TO_ENTITY, newId, probeServer, getOrCreateDeviceId, type WireOp } from './wire';

function isoNow(): string {
  return new Date().toISOString();
}

/* ────────────────────────────── Outbox ────────────────────────────── */

interface OutboxRow {
  seq?: number;
  op: WireOp;
}

class OutboxDB extends Dexie {
  outbox!: Table<OutboxRow, number>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({ outbox: '++seq' });
  }
}

export interface OutboxOptions {
  /** push 批量上限（server 上限 500，取較保守值）。 */
  maxBatch?: number;
  /** debounce 毫秒數（預設 200）。 */
  debounceMs?: number;
  /** 可注入 fetch（測試用）。 */
  fetchImpl?: typeof fetch;
}

/**
 * 持久化待推送操作隊列。FIFO（seq 自增），push 成功才出隊；
 * 失敗時以指數退避（1s → 30s 封頂）重試，重啟後自動續推。
 */
export class Outbox {
  private db: OutboxDB;
  private deviceId: string;
  private maxBatch: number;
  private debounceMs: number;
  private fetchImpl: typeof fetch;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private retryDelay = 0;

  constructor(deviceId: string, opts: OutboxOptions = {}, dbName = 'silvercare-sync-outbox') {
    this.deviceId = deviceId;
    this.maxBatch = opts.maxBatch ?? 250;
    this.debounceMs = opts.debounceMs ?? 200;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.db = new OutboxDB(dbName);
  }

  /** 入隊一筆 op；持久化完成後才排程 flush（debounce）。 */
  async enqueue(op: WireOp): Promise<void> {
    await this.db.outbox.add({ op });
    if (this.retryDelay > 0) this.scheduleFlush(this.retryDelay);
    else this.scheduleFlush(this.debounceMs);
  }

  /** 待推送筆數（測試／診斷用）。 */
  async pendingCount(): Promise<number> {
    return this.db.outbox.count();
  }

  /** 排程一次 flush（已有排程則不重複）。 */
  scheduleFlush(delayMs = this.debounceMs): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** 批量推送；成功出隊並續推，失敗保留並退避重試。 */
  async flush(): Promise<void> {
    if (this.pushing) return;
    this.pushing = true;
    try {
      for (;;) {
        const rows = await this.db.outbox.orderBy('seq').limit(this.maxBatch).toArray();
        if (rows.length === 0) {
          this.retryDelay = 0;
          return;
        }
        try {
          const res = await this.fetchImpl('/sync/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: this.deviceId, ops: rows.map((r) => r.op) }),
          });
          if (!res.ok) throw new Error(`push failed: HTTP ${res.status}`);
          await this.db.outbox.bulkDelete(rows.map((r) => r.seq as number));
          this.retryDelay = 0;
          // 續推剩餘（while 迴圈下一輪）
        } catch {
          // 網路失敗／server 暫不可達：保留隊列，指數退避重試
          this.retryDelay = this.retryDelay === 0 ? 1000 : Math.min(30_000, this.retryDelay * 2);
          this.scheduleFlush(this.retryDelay);
          return;
        }
      }
    } finally {
      this.pushing = false;
    }
  }

  /** 關閉（清排程；測試／卸載用）。 */
  close(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/* ────────────────────────────── SyncedProvider ────────────────────────────── */

/** 本地寫入 → 線協議 put op。 */
function makePutOp(table: TableName, entity: BaseEntity): WireOp {
  return {
    id: newId(),
    tbl: TABLE_TO_ENTITY[table],
    entityId: entity.id,
    updatedAt: entity.updatedAt,
    type: 'put',
    payload: { ...entity },
  };
}

/** 本地刪除 → 線協議 del op（tombstone）。 */
function makeDelOp(table: TableName, entityId: string): WireOp {
  return {
    id: newId(),
    tbl: TABLE_TO_ENTITY[table],
    entityId,
    updatedAt: isoNow(),
    type: 'del',
  };
}

export type SyncMode = 'sync' | 'standalone';

/**
 * 包裝 IndexedDBProvider 的同步版 DataProvider。
 *
 * - 未啟用同步（standalone）時：所有方法直接委派 inner，行為完全一致。
 * - enableSync() 成功後：寫入同時進 Outbox；遠端變更由 SyncClient 直接
 *   apply 到 inner（繞過 Outbox，避免循環推送）並觸發 subscribe。
 *
 * 上層（AssistantService / UI）只看到 DataProvider 接口，完全無感。
 */
export class SyncedProvider implements DataProvider {
  private inner: IndexedDBProvider;
  private outbox: Outbox | null = null;
  private syncClient: SyncClient | null = null;
  private deviceId = '';
  private pending: Promise<SyncMode> | null = null;

  constructor(inner?: IndexedDBProvider, private outboxDbName = 'silvercare-sync-outbox') {
    this.inner = inner ?? new IndexedDBProvider();
  }

  /** 目前是否處於 sync 模式。 */
  get syncEnabled(): boolean {
    return this.syncClient !== null;
  }

  /** 本裝置 ID（enableSync 後有意義）。 */
  get currentDeviceId(): string {
    return this.deviceId;
  }

  /**
   * 探測並啟用同步（冪等、絕不 throw）。
   * GET /api/health 可達 → sync 模式（bootstrap/pull + WS + Outbox）；
   * 否則維持 standalone（IndexedDB only）。
   */
  enableSync(fetchImpl?: typeof fetch): Promise<SyncMode> {
    if (this.syncClient) return Promise.resolve('sync' as SyncMode);
    if (this.pending) return this.pending;
    const doFetch = fetchImpl ?? fetch;
    this.pending = (async (): Promise<SyncMode> => {
      try {
        const reachable = await probeServer(doFetch);
        if (!reachable) return 'standalone';
        this.deviceId = getOrCreateDeviceId();
        this.outbox = new Outbox(this.deviceId, { fetchImpl: doFetch }, this.outboxDbName);
        this.syncClient = new SyncClient(this.inner, this.deviceId, {
          fetchImpl: doFetch,
          onConnected: () => {
            // 連線（重新）建立：把離線期間累積的 outbox 推出去
            void this.outbox?.flush();
          },
        });
        await this.syncClient.start();
        return 'sync';
      } catch {
        // 任何意外都不阻塞 App：降級 standalone
        this.syncClient = null;
        this.outbox = null;
        return 'standalone';
      }
    })();
    return this.pending.finally(() => {
      this.pending = null;
    });
  }

  /** 待推送 op 筆數（standalone 時為 0；診斷／測試用）。 */
  pendingOps(): Promise<number> {
    return this.outbox ? this.outbox.pendingCount() : Promise.resolve(0);
  }

  /** 立即嘗試推送 outbox（診斷／測試用）。 */
  flushOutbox(): Promise<void> {
    return this.outbox ? this.outbox.flush() : Promise.resolve();
  }

  /* ── 讀取：直接委派 ── */

  list<T extends BaseEntity>(table: TableName, filter?: ListFilter<T>): Promise<T[]> {
    return this.inner.list<T>(table, filter);
  }

  get<T extends BaseEntity>(table: TableName, id: string): Promise<T | undefined> {
    return this.inner.get<T>(table, id);
  }

  vitalsBetween(elderId: string, type: VitalType, from: string, to: string): Promise<VitalRecord[]> {
    return this.inner.vitalsBetween(elderId, type, from, to);
  }

  subscribe(cb: SubscribeCallback): Unsubscribe {
    return this.inner.subscribe(cb);
  }

  /** 入隊（持久化）；失敗只記錄不拋出 —— 本地寫入絕不因複製失敗而中斷。 */
  private async enqueueSafe(op: WireOp): Promise<void> {
    if (!this.outbox) return;
    try {
      await this.outbox.enqueue(op);
    } catch {
      // outbox 持久化失敗：本地寫入已完成，僅丟失該筆跨裝置複製
    }
  }

  /* ── 寫入：先本地、後 Outbox ── */

  async put<T extends BaseEntity>(table: TableName, entity: T): Promise<T> {
    const record = await this.inner.put(table, entity); // 1) 本地即時
    await this.enqueueSafe(makePutOp(table, record)); // 2) 複製入隊（持久化）
    return record;
  }

  async bulkPut(entries: BulkEntry[]): Promise<void> {
    const now = isoNow();
    // 先本地蓋章時間戳（與 inner.bulkPut 邏輯一致），確保 Outbox op 的
    // updatedAt / payload 與實際寫入完全相同。
    const stamped: BulkEntry[] = entries.map(({ table, entity }) => ({
      table,
      entity: {
        ...entity,
        createdAt: entity.createdAt ?? now,
        updatedAt: entity.updatedAt ?? now,
      },
    }));
    await this.inner.bulkPut(stamped); // 1) 本地即時
    for (const { table, entity } of stamped) {
      await this.enqueueSafe(makePutOp(table, entity)); // 2) 複製入隊
    }
  }

  async remove(table: TableName, id: string): Promise<void> {
    await this.inner.remove(table, id); // 1) 本地即時
    await this.enqueueSafe(makeDelOp(table, id)); // 2) 複製入隊
  }

  /**
   * 重置：本地清空（＋seed），同步模式下同時對舊資料發 del、對 seed 發 put，
   * 使兩裝置收斂（與 demoReset 同一 code path）。
   */
  async reset(seed?: SeedData): Promise<void> {
    if (this.outbox) {
      // 先對目前全部本地資料產生 tombstone
      for (const t of TABLE_NAME_LIST) {
        const rows = await this.inner.list(t);
        for (const r of rows) await this.enqueueSafe(makeDelOp(t, r.id));
      }
    }
    await this.inner.reset(seed);
    if (this.outbox && seed) {
      // reset 後重新讀取（inner 已蓋章時間戳），對 seed 結果產生 put op
      for (const t of TABLE_NAME_LIST) {
        const rows = await this.inner.list(t);
        for (const r of rows) await this.enqueueSafe(makePutOp(t, r));
      }
    }
  }

  /** 關閉（停止 WS／排程並關 DB；測試／卸載用）。 */
  close(): void {
    this.syncClient?.stop();
    this.outbox?.close();
    this.inner.close();
  }
}

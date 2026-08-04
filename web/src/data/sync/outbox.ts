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
import { TABLE_TO_ENTITY, authHeaders, newId, probeServer, getOrCreateDeviceId, type PushResult, type WireOp } from './wire';

function isoNow(): string {
  return new Date().toISOString();
}

/* ────────────────────────────── Outbox ────────────────────────────── */

interface OutboxRow {
  seq?: number;
  op: WireOp;
}

interface DeadRow {
  seq?: number;
  op: WireOp;
  /** 隔離時間（ISO）。 */
  at: string;
  /** 永久失敗的 HTTP 狀態碼。 */
  status: number;
}

class OutboxDB extends Dexie {
  outbox!: Table<OutboxRow, number>;
  /** 4xx 永久失敗隔離區（dead-letter；避免毒批次無限重試）。 */
  dead!: Table<DeadRow, number>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({ outbox: '++seq' });
    this.version(2).stores({ outbox: '++seq', dead: '++seq' });
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

  /** 4xx 永久失敗被隔離的筆數（dead-letter；診斷用）。 */
  async deadCount(): Promise<number> {
    return this.db.dead.count();
  }

  /** 排程一次 flush（已有排程則不重複）。 */
  scheduleFlush(delayMs = this.debounceMs): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /**
   * 批量推送與出隊規則（Warning 4 修復）：
   *  - HTTP 2xx：server 已收妥整批 → 全部出隊；回應中的 rejected op id
   *    （LWW 被較新寫入拒絕）console.warn 記錄 —— 絕不把 applied:0 當成功丟失，
   *    也絕不讓被拒 op 卡住隊列。
   *  - HTTP 4xx（408/429 除外）：永久失敗 → 該批寫入獨立 dead-letter store 隔離，
   *    避免毒批次無限重試；console.error 記錄。
   *  - HTTP 5xx／網路錯誤：暫時性 → 保留隊列，指數退避（1s → 30s 封頂）重試。
   */
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
        let res: Response;
        try {
          res = await this.fetchImpl('/sync/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ deviceId: this.deviceId, ops: rows.map((r) => r.op) }),
          });
        } catch {
          // 網路失敗／server 暫不可達：保留隊列，指數退避重試
          this.backoffAndReturn();
          return;
        }
        if (res.ok) {
          let body: PushResult = {};
          try {
            body = (await res.json()) as PushResult;
          } catch {
            // 回應體解析失敗不影響出隊（HTTP 2xx 即 server 已收妥）
          }
          if (Array.isArray(body.rejected) && body.rejected.length > 0) {
            console.warn(
              `[sync] server 以 LWW 拒絕 ${body.rejected.length} 筆 op（已被更新的寫入覆蓋；op 仍記入 server 日誌）：`,
              body.rejected,
            );
          }
          await this.db.outbox.bulkDelete(rows.map((r) => r.seq as number));
          this.retryDelay = 0;
          // 續推剩餘（while 迴圈下一輪）
          continue;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // 永久失敗（驗證／鑑權等）：隔離該批，不重試
          console.error(`[sync] push 永久失敗（HTTP ${res.status}）：隔離 ${rows.length} 筆 op 至 dead-letter，不再重試`);
          const at = isoNow();
          await this.db.dead.bulkAdd(rows.map((r) => ({ op: r.op, at, status: res.status })));
          await this.db.outbox.bulkDelete(rows.map((r) => r.seq as number));
          this.retryDelay = 0;
          continue;
        }
        // 5xx／408／429：暫時性失敗，退避重試
        this.backoffAndReturn();
        return;
      }
    } finally {
      this.pushing = false;
    }
  }

  private backoffAndReturn(): void {
    this.retryDelay = this.retryDelay === 0 ? 1000 : Math.min(30_000, this.retryDelay * 2);
    this.scheduleFlush(this.retryDelay);
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
function makeDelOp(table: TableName, entityId: string, updatedAt = isoNow()): WireOp {
  return {
    id: newId(),
    tbl: TABLE_TO_ENTITY[table],
    entityId,
    updatedAt,
    type: 'del',
  };
}

/**
 * Demo 重置的 seed 重蓋章（Critical 2 修復）：seed 實體原帶過去時間戳，
 * 直接 push 會被 LWW 拒絕（且 tombstone > seed put 會把第二裝置清空、
 * 永久分叉）。這裡對每筆 seed 重新蓋 `updatedAt = 現在`（嚴格晚於同次
 * reset 產生的全部 tombstone），保證 tombstone < seed put，server 與兩端
 * 一致收斂。createdAt 保留原值。
 */
function restampSeed(seed: SeedData, updatedAt: string): SeedData {
  const out = {} as SeedData;
  for (const key of Object.keys(seed) as (keyof SeedData)[]) {
    out[key] = (seed[key] as BaseEntity[]).map((e) => ({ ...e, updatedAt })) as never;
  }
  return out;
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

  /** 4xx 永久失敗被隔離（dead-letter）的 op 筆數（診斷／測試用）。 */
  deadOps(): Promise<number> {
    return this.outbox ? this.outbox.deadCount() : Promise.resolve(0);
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
   *
   * Critical 2 修復：sync 模式下 seed 實體一律重新蓋章 `updatedAt = 現在`
   * （嚴格晚於同次 reset 的 tombstone），避免 seed 帶過去時間戳被 LWW 拒絕、
   * 造成第二裝置被 tombstone 清空而永久分叉。createdAt 保留原值。
   * 注意：demo reset 不清空 outbox（既有待推 op 照推；LWW 下無害）。
   */
  async reset(seed?: SeedData): Promise<void> {
    if (this.outbox) {
      // 先對目前全部本地資料產生 tombstone
      for (const t of TABLE_NAME_LIST) {
        const rows = await this.inner.list(t);
        for (const r of rows) await this.enqueueSafe(makeDelOp(t, r.id));
      }
    }
    // seed 重蓋章：嚴格晚於上面所有 tombstone（+1ms 保證同毫秒也不平手）
    const effectiveSeed = this.outbox && seed ? restampSeed(seed, new Date(Date.now() + 1).toISOString()) : seed;
    await this.inner.reset(effectiveSeed);
    if (this.outbox && seed) {
      // reset 後重新讀取（inner 保留重蓋章的 updatedAt），對 seed 結果產生 put op
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

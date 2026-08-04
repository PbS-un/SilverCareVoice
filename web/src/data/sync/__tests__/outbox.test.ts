/**
 * T8 Outbox 單測：
 *  - 寫入順序：先本地（UI 即時可見）後 push（debounce）
 *  - push 失敗保留隊列並以指數退避重試，成功後出隊
 *  - server LWW rejected op：warn 並出隊（不卡隊列、不靜默丟失）
 *  - 4xx 永久失敗：隔離至 dead-letter，不再重試
 *  - 5xx：保留隊列退避重試
 *  - demo reset（sync 模式）：seed 重蓋章 updatedAt > tombstone，createdAt 保留
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBProvider } from '../../IndexedDBProvider';
import { SyncedProvider } from '../outbox';
import type { WireOp } from '../wire';
import type { SeedData } from '../../DataProvider';
import type { VitalRecord } from '../../../types/entities';

/** 運行時（vitest/Node 環境）存在 setImmediate，此處只補型別宣告。 */
declare const setImmediate: (callback: (...args: unknown[]) => void) => unknown;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function okJson(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

/**
 * fake timers 下讓真實 setImmediate 驅動的 Dexie / fake-indexeddb
 * 微觀任務跑完（flush 內部的 IDB 讀寫不會被 advanceTimersByTimeAsync 等到）。
 */
async function yieldToDb(times = 30): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}

const sampleVital: VitalRecord = {
  id: 'v-1',
  createdAt: '',
  updatedAt: '',
  elderId: 'e1',
  type: 'heart_rate',
  value: 72,
  unit: 'bpm',
  measuredAt: '2026-08-05T02:00:00.000Z',
  source: 'voice',
};

let dbSeq = 0;
let provider: SyncedProvider;

beforeEach(() => {
  // 只 fake setTimeout/clearTimeout：fake-indexeddb 與 Dexie 依賴真實 setImmediate，
  // 若一併 fake 會導致 IndexedDB 操作永久掛起。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.instances = [];
  localStorage.clear();
  dbSeq += 1;
});

afterEach(() => {
  provider?.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function syncModeFetch(pushBehavior: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith('/api/health')) return okJson({ ok: true });
    if (url.startsWith('/sync/bootstrap')) {
      return okJson({ serverTime: '2026-08-05T00:00:00.000Z', cursor: '7', entities: [] });
    }
    if (url.startsWith('/sync/pull')) {
      return okJson({ ops: [], cursor: '8', serverTime: '2026-08-05T00:00:00.000Z' });
    }
    if (url.startsWith('/sync/push')) return pushBehavior();
    throw new Error(`unexpected url ${url}`);
  });
}

describe('Outbox（local-first 寫入複製）', () => {
  it('寫入順序：先寫本地立即可見，之後 debounce 才 push；成功後出隊', async () => {
    const fetchMock = syncModeFetch(async () => okJson({ applied: ['op-1'], rejected: [], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' }));
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-a-${dbSeq}`), `sc-ob-a-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);
    expect(provider.syncEnabled).toBe(true);

    const beforePushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/sync/push')).length;

    // put 一返回，本地必須已可讀（UI 即時）
    const rec = await provider.put('vitalRecords', sampleVital);
    const local = await provider.get<VitalRecord>('vitalRecords', 'v-1');
    expect(local?.value).toBe(72);
    expect(rec.updatedAt).toBeTruthy();

    // 此時尚未 push（debounce 200ms 未到）
    let pushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/sync/push'));
    expect(pushCalls.length).toBe(beforePushCalls);
    expect(await provider.pendingOps()).toBe(1);

    // 超過 debounce → 批量 push
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    pushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/sync/push'));
    expect(pushCalls.length).toBe(beforePushCalls + 1);

    // 檢查 push body：deviceId + 線協議 op（tbl 用實體名 VitalRecord）
    const body = JSON.parse((pushCalls[pushCalls.length - 1][1] as RequestInit).body as string);
    expect(body.deviceId).toBe(provider.currentDeviceId);
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]).toMatchObject({
      tbl: 'VitalRecord',
      entityId: 'v-1',
      type: 'put',
      updatedAt: rec.updatedAt,
    });
    expect(body.ops[0].payload.value).toBe(72);

    // 成功後出隊
    expect(await provider.pendingOps()).toBe(0);
  });

  it('push 失敗：op 保留隊列，指數退避重試，成功後出隊', async () => {
    let pushCount = 0;
    const fetchMock = syncModeFetch(async () => {
      pushCount += 1;
      if (pushCount <= 2) throw new Error('server unreachable');
      return okJson({ applied: ['op-1'], rejected: [], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' });
    });
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-b-${dbSeq}`), `sc-ob-b-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    await provider.put('vitalRecords', sampleVital);

    // debounce 200ms → 第 1 次 push 失敗
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    expect(pushCount).toBe(1);
    expect(await provider.pendingOps()).toBe(1); // 保留

    // 退避 1s → 第 2 次 push 失敗
    await vi.advanceTimersByTimeAsync(1100);
    await yieldToDb();
    expect(pushCount).toBe(2);
    expect(await provider.pendingOps()).toBe(1); // 仍保留

    // 退避 2s → 第 3 次 push 成功
    await vi.advanceTimersByTimeAsync(2100);
    await yieldToDb();
    expect(pushCount).toBe(3);
    expect(await provider.pendingOps()).toBe(0); // 出隊
  });

  it('remove 產生 del op（tombstone）並先本地刪除', async () => {
    const fetchMock = syncModeFetch(async () => okJson({ applied: ['op-1'], rejected: [], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' }));
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-c-${dbSeq}`), `sc-ob-c-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    await provider.put('vitalRecords', sampleVital);
    await vi.advanceTimersByTimeAsync(250); // put 出隊
    await yieldToDb();
    expect(await provider.pendingOps()).toBe(0);

    await provider.remove('vitalRecords', 'v-1');
    expect(await provider.get('vitalRecords', 'v-1')).toBeUndefined(); // 本地即時刪除

    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    const pushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/sync/push'));
    const lastBody = JSON.parse((pushCalls[pushCalls.length - 1][1] as RequestInit).body as string);
    expect(lastBody.ops[0]).toMatchObject({ tbl: 'VitalRecord', entityId: 'v-1', type: 'del' });
    expect(await provider.pendingOps()).toBe(0);
  });

  it('server LWW rejected op：console.warn 記錄並出隊（不卡隊列、不靜默丟失）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = syncModeFetch(async () =>
      okJson({ applied: [], rejected: ['op-stale'], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' }),
    );
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-d-${dbSeq}`), `sc-ob-d-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    await provider.put('vitalRecords', sampleVital);
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();

    expect(await provider.pendingOps()).toBe(0); // 被拒 op 也出隊（server 已記入日誌）
    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toContain('op-stale');
    warnSpy.mockRestore();
  });

  it('push 4xx 永久失敗：該批隔離至 dead-letter，不再重試', async () => {
    let pushCount = 0;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = syncModeFetch(async () => {
      pushCount += 1;
      return { ok: false, status: 400, json: async () => ({ ok: false, error: 'invalid_request' }) };
    });
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-e-${dbSeq}`), `sc-ob-e-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    await provider.put('vitalRecords', sampleVital);
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    expect(pushCount).toBe(1);
    expect(await provider.pendingOps()).toBe(0); // 出隊
    expect(await provider.deadOps()).toBe(1); // 隔離

    // 再等幾個退避週期：不應再重試（毒批次已隔離）
    await vi.advanceTimersByTimeAsync(10_000);
    await yieldToDb();
    expect(pushCount).toBe(1);
    errSpy.mockRestore();
  });

  it('push 5xx：保留隊列並指數退避重試，成功後出隊', async () => {
    let pushCount = 0;
    const fetchMock = syncModeFetch(async () => {
      pushCount += 1;
      if (pushCount <= 1) return { ok: false, status: 503, json: async () => ({ ok: false, error: 'unavailable' }) };
      return okJson({ applied: ['op-1'], rejected: [], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' });
    });
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-f-${dbSeq}`), `sc-ob-f-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    await provider.put('vitalRecords', sampleVital);
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    expect(pushCount).toBe(1);
    expect(await provider.pendingOps()).toBe(1); // 保留
    expect(await provider.deadOps()).toBe(0); // 不隔離

    await vi.advanceTimersByTimeAsync(1100); // 退避 1s 後重試成功
    await yieldToDb();
    expect(pushCount).toBe(2);
    expect(await provider.pendingOps()).toBe(0);
  });

  it('sync 模式 reset：seed 重蓋章（updatedAt 晚於 tombstone）、createdAt 保留、兩端收斂', async () => {
    const fetchMock = syncModeFetch(async () =>
      okJson({ applied: ['op-1'], rejected: [], duplicated: [], serverTime: '2026-08-05T00:00:00.000Z' }),
    );
    provider = new SyncedProvider(new IndexedDBProvider(`sc-ob-g-${dbSeq}`), `sc-ob-g-out-${dbSeq}`);
    await provider.enableSync(fetchMock as unknown as typeof fetch);

    // 先寫入一筆既有資料（reset 時應收到 tombstone）
    await provider.put('vitalRecords', sampleVital);
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    expect(await provider.pendingOps()).toBe(0);

    // 構建最小 seed（僅 vitalRecords 一筆；createdAt 為過去值）
    const empty = {
      users: [], elderProfiles: [], caregivers: [], caregiverLinks: [], chronicConditions: [],
      vitalRecords: [], medications: [], medicationLogs: [], symptomRecords: [], appointments: [],
      healthEvents: [], alerts: [], caregiverFollowUps: [], conversations: [], serviceQueries: [],
      consents: [], auditLogs: [], resourceDirectory: [], knowledgeDocuments: [],
    } as SeedData;
    const seed: SeedData = {
      ...empty,
      vitalRecords: [
        {
          id: 'seed-v-1',
          elderId: 'e1',
          type: 'heart_rate',
          value: 66,
          unit: 'bpm',
          measuredAt: '2020-01-01T00:00:00.000Z',
          source: 'seed',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z', // 過去時間戳 → 必須被重蓋章
        },
      ],
    };

    await provider.reset(seed);

    // 本地：seed 寫入，createdAt 保留原值、updatedAt 被重蓋章為近期
    const local = await provider.get<VitalRecord>('vitalRecords', 'seed-v-1');
    expect(local?.value).toBe(66);
    expect(local?.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(new Date(local!.updatedAt).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());

    // 出隊推送：收集全部 push body 的 ops
    await vi.advanceTimersByTimeAsync(250);
    await yieldToDb();
    const pushCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/sync/push'));
    const allOps = pushCalls.flatMap((c) => (JSON.parse((c[1] as RequestInit).body as string).ops as WireOp[]));
    const tombstones = allOps.filter((op) => op.type === 'del' && op.entityId === 'v-1');
    const seedPuts = allOps.filter((op) => op.type === 'put' && op.entityId === 'seed-v-1');
    expect(tombstones).toHaveLength(1);
    expect(seedPuts).toHaveLength(1);
    // 關鍵：seed put 的 updatedAt 嚴格晚於 tombstone → LWW 下兩端收斂不分叉
    expect(seedPuts[0].updatedAt > tombstones[0].updatedAt).toBe(true);
    // seed put payload 保留原 createdAt
    expect(seedPuts[0].payload?.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(seedPuts[0].payload?.updatedAt).toBe(seedPuts[0].updatedAt);
    expect(await provider.pendingOps()).toBe(0);
  });
});

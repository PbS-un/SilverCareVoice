/**
 * T8 Outbox 單測：
 *  - 寫入順序：先本地（UI 即時可見）後 push（debounce）
 *  - push 失敗保留隊列並以指數退避重試，成功後出隊
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBProvider } from '../../IndexedDBProvider';
import { SyncedProvider } from '../outbox';
import type { VitalRecord } from '../../../types/entities';

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
      return okJson({ serverTime: '2026-08-05T00:00:00.000Z', entities: [] });
    }
    if (url.startsWith('/sync/pull')) {
      return okJson({ ops: [], cursor: '2026-08-05T00:00:00.000Z', serverTime: '2026-08-05T00:00:00.000Z' });
    }
    if (url.startsWith('/sync/push')) return pushBehavior();
    throw new Error(`unexpected url ${url}`);
  });
}

describe('Outbox（local-first 寫入複製）', () => {
  it('寫入順序：先寫本地立即可見，之後 debounce 才 push；成功後出隊', async () => {
    const fetchMock = syncModeFetch(async () => okJson({ applied: 1, serverTime: '2026-08-05T00:00:00.000Z' }));
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
      return okJson({ applied: 1, serverTime: '2026-08-05T00:00:00.000Z' });
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
    const fetchMock = syncModeFetch(async () => okJson({ applied: 1, serverTime: '2026-08-05T00:00:00.000Z' }));
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
});

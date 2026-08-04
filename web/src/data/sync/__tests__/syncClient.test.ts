/**
 * T8 Sync 客戶端單測：
 *  - 探測失敗降級 standalone
 *  - bootstrap apply 採 LWW（較新覆蓋、較舊保留、tombstone 刪除）
 *  - WS change ops apply 到本地並觸發 subscribe
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBProvider } from '../../IndexedDBProvider';
import { SyncedProvider } from '../outbox';
import { LS_SYNC_CURSOR } from '../wire';
import type { VitalRecord } from '../../../types/entities';

/* ── 可控 WebSocket 假體 ── */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function okJson(body: unknown): { ok: true; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

/** 等微任務＋少量實時延遲，讓異步 apply 完成。 */
function settle(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let dbSeq = 0;
let provider: SyncedProvider;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.instances = [];
  localStorage.clear();
  dbSeq += 1;
});

afterEach(() => {
  provider?.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeProvider(): SyncedProvider {
  const inner = new IndexedDBProvider(`sc-sync-test-${dbSeq}`);
  return new SyncedProvider(inner, `sc-outbox-test-${dbSeq}`);
}

describe('SyncClient / SyncedProvider', () => {
  it('探測失敗 → 降級 standalone（不碰 /sync，不阻塞）', async () => {
    const fetchMock = vi.fn(async (_url: string) => {
      throw new Error('network down');
    });
    provider = makeProvider();
    const mode = await provider.enableSync(fetchMock as unknown as typeof fetch);
    expect(mode).toBe('standalone');
    expect(provider.syncEnabled).toBe(false);
    // 只有 health 探測，沒有任何 /sync 呼叫
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.startsWith('/api/health'))).toBe(true);
    // standalone 寫入仍正常（純本地）
    const rec = await provider.put<VitalRecord>('vitalRecords', {
      id: 'v-off',
      createdAt: '',
      updatedAt: '',
      elderId: 'e1',
      type: 'heart_rate',
      value: 70,
      unit: 'bpm',
      measuredAt: '2026-08-01T08:00:00.000Z',
      source: 'voice',
    });
    expect(await provider.get('vitalRecords', rec.id)).toBeDefined();
  });

  it('bootstrap apply 採 LWW：較新覆蓋、較舊保留、tombstone 刪除、新增匯入', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/health')) return okJson({ ok: true });
      if (url.startsWith('/sync/bootstrap')) {
        return okJson({
          serverTime: '2026-08-05T00:00:00.000Z',
          entities: [
            {
              // 本地較新 → 不得覆蓋
              tbl: 'VitalRecord',
              entityId: 'local-newer',
              updatedAt: '2020-01-01T00:00:00.000Z',
              payload: { id: 'local-newer', value: 999, unit: 'X' },
              deleted: false,
            },
            {
              // 本地較舊 → 覆蓋
              tbl: 'VitalRecord',
              entityId: 'local-older',
              updatedAt: '2026-07-01T00:00:00.000Z',
              payload: {
                id: 'local-older',
                elderId: 'e1',
                type: 'heart_rate',
                value: 88,
                unit: 'bpm',
                measuredAt: '2026-06-30T23:00:00.000Z',
                source: 'voice',
                createdAt: '2026-06-30T23:00:00.000Z',
              },
              deleted: false,
            },
            {
              // tombstone → 本地刪除
              tbl: 'VitalRecord',
              entityId: 'to-delete',
              updatedAt: '2026-07-02T00:00:00.000Z',
              payload: {},
              deleted: true,
            },
            {
              // 本地沒有 → 匯入
              tbl: 'VitalRecord',
              entityId: 'new-remote',
              updatedAt: '2026-07-03T00:00:00.000Z',
              payload: {
                id: 'new-remote',
                elderId: 'e1',
                type: 'weight',
                value: 60,
                unit: 'kg',
                measuredAt: '2026-07-03T00:00:00.000Z',
                source: 'form',
                createdAt: '2026-07-03T00:00:00.000Z',
              },
              deleted: false,
            },
          ],
        });
      }
      if (url.startsWith('/sync/pull')) {
        return okJson({ ops: [], cursor: '2026-08-05T00:00:00.000Z', serverTime: '2026-08-05T00:00:00.000Z' });
      }
      return okJson({ applied: 0, serverTime: '2026-08-05T00:00:00.000Z' });
    });

    const inner = new IndexedDBProvider(`sc-sync-test-${dbSeq}`);
    // 先種本地資料（bulkPut 保留指定 updatedAt）
    await inner.bulkPut([
      {
        table: 'vitalRecords',
        entity: { id: 'local-newer', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z', value: 1 } as VitalRecord,
      },
      {
        table: 'vitalRecords',
        entity: { id: 'local-older', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', value: 2 } as VitalRecord,
      },
      {
        table: 'vitalRecords',
        entity: { id: 'to-delete', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', value: 3 } as VitalRecord,
      },
    ]);

    provider = new SyncedProvider(inner, `sc-outbox-test-${dbSeq}`);
    const mode = await provider.enableSync(fetchMock as unknown as typeof fetch);
    expect(mode).toBe('sync');
    expect(provider.syncEnabled).toBe(true);

    // LWW 結果
    const newer = await provider.get<VitalRecord>('vitalRecords', 'local-newer');
    expect(newer?.value).toBe(1); // 未被覆蓋
    expect(newer?.updatedAt).toBe('2099-01-01T00:00:00.000Z');

    const older = await provider.get<VitalRecord>('vitalRecords', 'local-older');
    expect(older?.value).toBe(88); // 被遠端覆蓋
    expect(older?.updatedAt).toBe('2026-07-01T00:00:00.000Z');

    expect(await provider.get('vitalRecords', 'to-delete')).toBeUndefined(); // tombstone
    expect((await provider.get<VitalRecord>('vitalRecords', 'new-remote'))?.value).toBe(60); // 匯入

    // cursor 持久化
    expect(localStorage.getItem(LS_SYNC_CURSOR)).toBe('2026-08-05T00:00:00.000Z');
  });

  it('WS change ops apply 到本地並觸發 subscribe 通知', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/health')) return okJson({ ok: true });
      if (url.startsWith('/sync/bootstrap')) {
        return okJson({ serverTime: '2026-08-05T00:00:00.000Z', entities: [] });
      }
      return okJson({ ops: [], cursor: '2026-08-05T00:00:00.000Z', serverTime: '2026-08-05T00:00:00.000Z' });
    });

    provider = makeProvider();
    const seen: string[] = [];
    provider.subscribe((t) => seen.push(t));

    const mode = await provider.enableSync(fetchMock as unknown as typeof fetch);
    expect(mode).toBe('sync');

    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();
    ws.open();
    // hello 已送出
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'hello' });
    ws.receive({ type: 'hello_ok', deviceId: provider.currentDeviceId, serverTime: '2026-08-05T00:00:01.000Z' });
    await settle();

    // 收到其他裝置的 change（put 一筆 VitalRecord）
    ws.receive({
      type: 'change',
      originDeviceId: 'dev-other',
      ops: [
        {
          id: 'op-1',
          tbl: 'VitalRecord',
          entityId: 'remote-v1',
          updatedAt: '2026-08-05T01:00:00.000Z',
          type: 'put',
          payload: {
            id: 'remote-v1',
            elderId: 'e1',
            type: 'blood_pressure',
            systolic: 128,
            diastolic: 82,
            unit: 'mmHg',
            measuredAt: '2026-08-05T01:00:00.000Z',
            source: 'voice',
            createdAt: '2026-08-05T01:00:00.000Z',
          },
        },
      ],
    });
    await settle();

    // 本地可見，且 subscribe 被觸發
    const rec = await provider.get<VitalRecord>('vitalRecords', 'remote-v1');
    expect(rec?.systolic).toBe(128);
    expect(seen).toContain('vitalRecords');
  });

  it('WS 斷線 → 指數退避重連', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.startsWith('/api/health')) return okJson({ ok: true });
        if (url.startsWith('/sync/bootstrap')) {
          return okJson({ serverTime: '2026-08-05T00:00:00.000Z', entities: [] });
        }
        return okJson({ ops: [], cursor: '2026-08-05T00:00:00.000Z', serverTime: '2026-08-05T00:00:00.000Z' });
      });
      provider = makeProvider();
      await provider.enableSync(fetchMock as unknown as typeof fetch);
      expect(FakeWebSocket.instances.length).toBe(1);

      // 第一次斷線 → 1s 後重連
      FakeWebSocket.instances[0].close();
      await vi.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.instances.length).toBe(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(FakeWebSocket.instances.length).toBe(2);

      // 第二次斷線 → 2s 後重連（指數退避）
      FakeWebSocket.instances[1].close();
      await vi.advanceTimersByTimeAsync(1900);
      expect(FakeWebSocket.instances.length).toBe(2);
      await vi.advanceTimersByTimeAsync(200);
      expect(FakeWebSocket.instances.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

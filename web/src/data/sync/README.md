# T8 Sync 客戶端（local-first 雙裝置同步）

`web/src/data/sync/` — SilverCare Voice 的雙裝置 LAN 同步層。
對應 server：`server/sync/**`（埠 8787，API 契約見 server/README.md）。

## 檔案

| 檔案 | 職責 |
| --- | --- |
| `wire.ts` | 線協議型別（`WireOp` / `BootstrapEntity`）、本地表名 ↔ server 實體名映射、deviceId / cursor / 超時 fetch 等 helper |
| `outbox.ts` | `Outbox`（持久化待推送隊列，IndexedDB 獨立 store `silvercare-sync-outbox`）＋ `SyncedProvider`（包裝 `IndexedDBProvider` 的 DataProvider，寫入同時進 outbox） |
| `SyncClient.ts` | 啟動探測後流程：bootstrap / pull、WS 連線與指數退避重連、change apply（LWW）、visibilitychange 補漏 |
| `__tests__/` | Vitest 單測（fake-indexeddb + mock fetch/WebSocket） |
| `scripts/two-device-check.mjs` | 雙裝置整合驗證腳本（純 Node） |

## 設計要點

- **線協議 tbl 用實體名**（PascalCase，如 `VitalRecord`），本地 Dexie 用 store 名
  （camelCase，如 `vitalRecords`）。映射在 `wire.ts`（`TABLE_TO_ENTITY` / `tableOfEntity`）。
- **local-first 寫入**：`SyncedProvider.put/bulkPut/remove/reset` 一律先寫本地
  IndexedDB（UI 即時、subscribe 即時觸發），再把 op 持久化進 outbox；
  outbox debounce 200ms 後批量 `POST /sync/push`，成功出隊，失敗指數退避
  （1s → 30s 封頂）重試，重啟續推。
- **standalone 降級**：`getProvider()` 首次取用時背景探測 `GET /api/health`
  （2s 超時）。不可達 → 純 IndexedDB，行為與無同步完全一致。探測絕不阻塞 App。
- **遠端變更**：`SyncClient` 直接寫底層 IndexedDBProvider（繞過 outbox，避免循環
  推送）；LWW by `updatedAt`（平手保留本地，與 server 一致）；tombstone 刪本地。
  寫入經 provider `emit` 自動觸發 `subscribe`，UI 無需任何改動。
- **補漏**：WS 握手成功與 `visibilitychange` 回前台時，以 `/sync/pull?since=cursor`
  補漏；cursor / lastSyncAt 存 localStorage（`scv.syncCursor` / `scv.lastSyncAt`）。
- deviceId 存 localStorage `scv.deviceId`（每裝置唯一）。

## 接入說明（UI / 測試任務）

- **UI 完全無感**：照舊用 `getProvider()` 的 `list/get/put/bulkPut/remove/reset/subscribe`，
  單一 code path，無 build flag、無 demo-only 分支。server 可達自動同步，否則離線。
- 需要等待／診斷同步狀態時可用 `DataProvider.ts` 匯出的
  `enableSync(): Promise<'sync' | 'standalone'>`（冪等）；
  `SyncedProvider.pendingOps()` / `flushOutbox()` 供診斷。
- 單測請繼續用 `fake-indexeddb/auto`；vitest 環境（`MODE === 'test'`）下
  `getProvider()` 不會自動探測，需要同步行為時自行 `new SyncedProvider(...)`
  ＋注入 mock fetch（見 `__tests__/`）。
- 注意：fake timers 只能 fake `setTimeout/clearTimeout`（`toFake` 選項）——
  fake-indexeddb / Dexie 依賴真實 `setImmediate`，全部 fake 會掛起。

## 驗證命令（Windows PowerShell，用 `;` 不用 `&&`）

### 1. 單測

```powershell
cd web ; npx vitest run src/data/sync
```

7 例：探測失敗降級 standalone、bootstrap LWW、change apply 觸發 subscribe、
WS 斷線指數退避重連、寫入順序（先本地後 push）、push 失敗保留重試、del tombstone。

### 2. 雙裝置整合驗證（需 server 運行）

```powershell
# 終端 1：啟動 server（埠 8787）
npm run dev:server

# 終端 2：執行雙裝置驗證腳本（模擬 device A 寫入 → device B WS 收到）
node web/src/data/sync/scripts/two-device-check.mjs
```

預期輸出（最後一行 `PASS`，exit 0）：

```
[ok] /api/health 可達
[ok] device B WS 註冊成功（hello_ok）
[ok] device B 收到 change（origin=dev-integ-A-…，entityId=integ-vital-…）
[ok] device A push 成功（applied=1）
[ok] /sync/pull 可讀取該筆記錄
PASS：device A 寫入 → device B 經 WS 即時收到（雙裝置同步正常）
```

### 3. 瀏覽器手動驗證（選用）

```powershell
npm run dev:server          # 終端 1
npm run dev                 # 終端 2：vite dev（5173，proxy /sync、/ws → 8787）
```

開兩個瀏覽器（或一個瀏覽器＋無痕跡視窗，localStorage 各自獨立）：
A 寫入一筆生命徵象 → B 的 `subscribe` 自動刷新、本地 IndexedDB 出現該筆。

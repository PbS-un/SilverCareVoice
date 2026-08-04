# T8 Sync 客戶端（local-first 雙裝置同步）

`web/src/data/sync/` — SilverCare Voice 的雙裝置 LAN 同步層。
對應 server：`server/sync/**`（埠 8787，API 契約見 server/README.md）。

## 檔案

| 檔案 | 職責 |
| --- | --- |
| `wire.ts` | 線協議型別（`WireOp` / `BootstrapEntity` / `PushResult`）、本地表名 ↔ server 實體名映射、deviceId / cursor / token / 超時 fetch 等 helper |
| `outbox.ts` | `Outbox`（持久化待推送隊列，IndexedDB 獨立 store `silvercare-sync-outbox`；4xx 永久失敗隔離至 dead-letter store）＋ `SyncedProvider`（包裝 `IndexedDBProvider` 的 DataProvider，寫入同時進 outbox） |
| `SyncClient.ts` | 啟動探測後流程：bootstrap / pull（seq cursor 分頁）、WS 連線（hello 帶 token）與指數退避重連、change apply（LWW＋確定性 tiebreaker）、visibilitychange 補漏 |
| `__tests__/` | Vitest 單測（fake-indexeddb + mock fetch/WebSocket） |
| `scripts/two-device-check.mjs` | 雙裝置整合驗證腳本（純 Node；含 reset 收斂／慢時鐘／無 token 401 場景） |
| `scripts/e2e-global-setup.ts` | Playwright globalSetup：E2E 前在 server 端做一次 demo seed |

## 設計要點

- **線協議 tbl 用實體名**（PascalCase，如 `VitalRecord`），本地 Dexie 用 store 名
  （camelCase，如 `vitalRecords`）。映射在 `wire.ts`（`TABLE_TO_ENTITY` / `tableOfEntity`）。
- **游標語義（Critical 修復）**：pull 游標是 **server 端單調遞增 seq（數字字串）**，
  絕非客戶端 `updatedAt` —— 離線／慢時鐘裝置的 op 不會被永久遺漏。
  localStorage 舊版 ISO 時間游標偵測即丟棄、自動改走 bootstrap。
  單頁 1000 筆，滿頁以新 cursor 續拉。
- **local-first 寫入**：`SyncedProvider.put/bulkPut/remove/reset` 一律先寫本地
  IndexedDB（UI 即時、subscribe 即時觸發），再把 op 持久化進 outbox；
  outbox debounce 200ms 後批量 `POST /sync/push`。出隊規則：
  HTTP 2xx → 全部出隊（server 回應 `applied/rejected/duplicated` op id 陣列；
  rejected 會 console.warn 但照樣出隊——server 已記入日誌，絕不靜默丟失）；
  4xx（408/429 除外）→ 永久失敗，該批隔離至獨立 dead-letter store 不重試；
  5xx／網路錯誤 → 保留隊列指數退避（1s → 30s 封頂）重試，重啟續推。
- **demo reset（Critical 修復）**：sync 模式下 `reset(seed)` 對每筆 seed 實體
  重新蓋章 `updatedAt = 現在`（嚴格晚於同次 reset 的 tombstone，createdAt 保留），
  保證 tombstone < seed put，兩裝置與 server 一致收斂不分叉。
  **注意：demo reset 不清空 outbox**（既有待推 op 照推；LWW 下無害）。
- **standalone 降級**：`getProvider()` 首次取用時背景探測 `GET /api/health`
  （2s 超時）。不可達 → 純 IndexedDB，行為與無同步完全一致。探測絕不阻塞 App。
  App 啟動先 `await enableSync()` 再判空庫：只有 standalone 且空庫才自動
  demoReset（sync 模式資料有無由 bootstrap 決定）。
- **遠端變更**：`SyncClient` 直接寫底層 IndexedDBProvider（繞過 outbox，避免循環
  推送）；LWW by `updatedAt`，**平手比 deviceId 字典序（大者勝）**——與 server
  pushOps 同一確定性 tiebreaker，同毫秒雙寫不分叉；tombstone 刪本地。
  寫入經 provider `emit` 自動觸發 `subscribe`，UI 無需任何改動。
- **鑑權（Warning 5）**：/sync/* 與 WS hello 需 SYNC_TOKEN。web 端自
  localStorage `scv.syncToken` 讀取；首次配對可在 URL 加 `?syncToken=<token>`
  （自動持久化）。token 見 server 啟動日誌（詳 server/README.md「同步鑑權」）。
  401 / auth_error 時 SyncClient 停止重試並 console.warn 提示配對方式。
- **補漏**：WS 握手成功與 `visibilitychange` 回前台時，以 `/sync/pull?since=<cursor>`
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

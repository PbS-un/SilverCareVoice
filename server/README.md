# SilverCare Voice — Server

> **定位**：本 server 為**本地開發（模式 B）與合約參照實現**——`/api/*` 與
> `/sync/*` 的 API／同步協議合約以此為準，Supabase Edge Function 實作同一
> 合約。**生產演示後端為 Supabase**（Edge Function `supabase/functions/silvercare`
> ＋Postgres op-log/LWW＋Realtime 廣播），部署與評委配對步驟見
> [../supabase/DEPLOYMENT.md](../supabase/DEPLOYMENT.md)。

單一 Node ESM 進程（Express + WS + SQLite，埠 8787），承載：

- **A. DeepSeek AI Proxy**：密鑰安全邊界，前端永不接觸 API Key
- **B. Local Sync Server**：雙裝置 LAN 同步（op-log + LWW）

## 啟動

```powershell
# 在 repo 根目錄
npm run dev:server     # node --watch
# 或
npm run start --workspace server
```

首次使用請複製環境變數範本：

```powershell
Copy-Item server/.env.example server/.env   # 再填入 DEEPSEEK_API_KEY
```

## 環境變數（server/.env，已 gitignore）

| 變數 | 預設 | 說明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 留空 → `/api/ai/chat` 回 `{provider:'local', reason:'no_key'}` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 端點 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型 |
| `PORT` | `8787` | web dev proxy（`/api`、`/sync`、`/ws`）轉發目標 |
| `SYNC_TOKEN` | 空（自動生成） | 雙裝置同步配對 token；留空 → 每次啟動自動生成並打印到啟動日誌 |

SQLite 檔案存於 `server/data/sync.sqlite`（gitignore），WAL 模式。

## 同步鑑權（SYNC_TOKEN，Demo 性質）

`/sync/*` 與 WS `/ws` 載送健康資料，LAN 上不宜裸露，故加最低限度鑑權：

- server 啟動時從 env `SYNC_TOKEN` 讀取配對 token；未設定則自動生成
  （`crypto.randomBytes(16)` hex）並**打印到啟動日誌**（`[silvercare] SYNC_TOKEN=…`）。
- `/sync/*` 要求 `Authorization: Bearer <token>` 或 query `?token=<token>`，否則 401。
- WS `hello` 需帶 `token` 欄位（或 upgrade URL `?token=`），驗證失敗回
  `{type:'auth_error'}` 並斷線；未通過驗證的 socket 永不收到 change 廣播。
- **配對流程（簡化版）**：第一台裝置啟動 server 後從日誌取得 token；
  第二台裝置瀏覽器開啟 App 時於 URL 加 `?syncToken=<token>`（web 端自動
  存入 localStorage `scv.syncToken`，只需帶一次）。
- **Demo 性質限制**：單一靜態共享 token、無 per-user 帳號、無 TLS 時
  token 明文過 LAN、server 日誌可見 token —— 只適用於可信賴的家庭／演示
  LAN，不構成生產級安全邊界。

## API

### `GET /api/health`
`{ ok: true, service, time }`

### `POST /api/ai/chat`
Body：`{ text: string, context?: object }`

回應：`{ provider, reason?, analysis? }`，provider 為：

| provider | 情境 |
|---|---|
| `local` | server 無 `DEEPSEEK_API_KEY`，客戶端改用本地引擎 |
| `safety` | 高風險詞表觸發（胸痛/暈倒/…），不調 LLM，`analysis.intent='emergency'` |
| `deepseek` | LLM 成功且通過 zod 驗證，`analysis` 為 `{intent, riskLevel, answer, detailedAnswer?, extractedData?, actions?}` |
| `fallback` | LLM 輸出驗證失敗（重試一次後）或通訊錯誤，客戶端改用本地引擎 |

`intent` 限定 13 值：symptom / vital_record / medication_taken / medication_missed / appointment_query / health_history / policy_query / medical_resource_query / family_contact / family_status_query / emergency / general_health_question / unknown

### 同步端點（需 SYNC_TOKEN，見上節）

| 端點 | 說明 |
|---|---|
| `POST /sync/push` | Body `{ deviceId, ops: [{id, tbl, entityId, updatedAt, type:'put'\|'del', payload?}] }` → `{ applied, rejected, duplicated, serverTime }`（三者皆 op id 陣列）。`applied`＝覆蓋當前狀態；`rejected`＝記入 ops 日誌但被 LWW 拒絕；`duplicated`＝重複 op id。凡列入任一者 server 皆已收妥，客戶端可安全出隊。同時經 WS 廣播給其他裝置。`tbl` 限 19 實體白名單。 |
| `GET /sync/bootstrap` | `{ entities: [{tbl, entityId, updatedAt, payload, deleted, deviceId}], cursor, serverTime }`（首次加入用；`cursor`＝ops 日誌當前最大 seq） |
| `GET /sync/pull?since=<seq>` | `{ ops, cursor, serverTime }`。`since`/`cursor` 為 **server 端單調遞增 seq（數字字串）**——絕非客戶端 updatedAt（客戶端時鐘可慢/可錯，時間游標會永久遺漏離線裝置 op）。單頁上限 1000 筆，滿頁以新 cursor 續拉。 |

合併規則：LWW —— `updatedAt` 較新者覆蓋當前狀態；**平手時以來源 deviceId
字典序較大者勝**（確定性 tiebreaker，server 與客戶端同一規則，同毫秒雙寫
不分叉）；`del` 寫 tombstone（`deleted: true`）。`updatedAt` 只作 LWW 比較，
同步游標一律用 seq。

### WS `/ws`

| 方向 | 訊息 |
|---|---|
| 客戶端 → | `{ type:'hello', deviceId, token }` 註冊裝置（token＝SYNC_TOKEN；亦接受 upgrade URL `?token=`） |
| 伺服器 → | `{ type:'hello_ok', deviceId, serverTime }`；驗證失敗 `{ type:'auth_error', message }` 並斷線 |
| 客戶端 → | `{ type:'ping' }` → 伺服器回 `{ type:'pong', serverTime }` |
| 伺服器 → | `{ type:'change', ops, originDeviceId }`（其他裝置 push 成功，排除來源裝置） |

Server 每 30s 心跳 ping，無 pong 即斷線。

## CORS

僅允許 `http(s)://localhost[:port]` 與 `http(s)://127.0.0.1[:port]` 來源（開發環境）。

## 驗證腳本

```powershell
# smoke 需與 server 一致的 SYNC_TOKEN（server 啟動日誌有打印）：
$env:SYNC_TOKEN='<token>' ; node server/scripts/smoke.mjs
#   測 health/chat/無 token 401（HTTP+WS）/push 每筆 op 結果/seq cursor/慢時鐘不遺漏

node server/scripts/smoke-ai.mjs   # 需帶 DEEPSEEK_API_KEY（可為 dummy）運行；測 safety 與 fallback 路徑
```


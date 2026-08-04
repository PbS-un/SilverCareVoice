# SilverCare Voice — Server

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

SQLite 檔案存於 `server/data/sync.sqlite`（gitignore），WAL 模式。

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

### 同步端點

| 端點 | 說明 |
|---|---|
| `POST /sync/push` | Body `{ deviceId, ops: [{id, tbl, entityId, updatedAt, type:'put'\|'del', payload?}] }` → `{ applied, serverTime }`；同時經 WS 廣播給其他裝置。`tbl` 限 19 實體白名單。 |
| `GET /sync/bootstrap` | `{ entities: [{tbl, entityId, updatedAt, payload, deleted}], serverTime }`（首次加入用） |
| `GET /sync/pull?since=<ISO>` | `{ ops, cursor, serverTime }`（增量 ops，cursor 供下次 since） |

合併規則：LWW —— 僅當 incoming `updatedAt` 較新才覆蓋當前狀態；`del` 寫 tombstone（`deleted: true`）。

### WS `/ws`

| 方向 | 訊息 |
|---|---|
| 客戶端 → | `{ type:'hello', deviceId }` 註冊裝置 |
| 伺服器 → | `{ type:'hello_ok', deviceId, serverTime }` |
| 客戶端 → | `{ type:'ping' }` → 伺服器回 `{ type:'pong', serverTime }` |
| 伺服器 → | `{ type:'change', ops, originDeviceId }`（其他裝置 push 成功，排除來源裝置） |

Server 每 30s 心跳 ping，無 pong 即斷線。

## CORS

僅允許 `http(s)://localhost[:port]` 與 `http(s)://127.0.0.1[:port]` 來源（開發環境）。

## 驗證腳本

```powershell
node server/scripts/smoke.mjs      # 需 server 運行中；測 health/chat/sync/WS 廣播（17 項）
node server/scripts/smoke-ai.mjs   # 需帶 DEEPSEEK_API_KEY（可為 dummy）運行；測 safety 與 fallback 路徑
```


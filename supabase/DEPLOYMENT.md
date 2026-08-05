# SilverCareVoice — Supabase 部署指引

本指引帶你（或評委／協作者）從零把 SilverCareVoice 的 **Supabase 後端**
（資料庫遷移 + Edge Function「silvercare」）部署上線，並把前端接上
GitHub Pages CI，完成「雙裝置同步」演示環境。

> 架構速覽：前端只跟 **一個 Edge Function**（`silvercare`）溝通，
> 端點包含 `/api/health`、`/api/ai/chat`、`/sync/bootstrap|pull|push`。
> 同步以 **SYNC_TOKEN** 鑑權（Bearer 或 `?token=`），
> room = SHA-256(SYNC_TOKEN) 前 16 hex，天然隔離不同隊伍／評審組。

---

## 0. 前置：安裝並登入 Supabase CLI

```powershell
# 方式一（推薦）：npm 全域安裝
npm i -g supabase

# 方式二：官方 Windows 安裝（Scoop）
scoop install supabase

# 驗證版本
supabase --version

# 登入（會開瀏覽器完成授權；把產生的 access token 貼回終端）
supabase login
```

> 本任務全程使用 **PowerShell**；多條指令請用分號 `;` 分隔（不要用 `&&`）。

---

## 1. 建立專案，記錄四組關鍵值

本專案已建立，關鍵值如下（密鑰體系為新版 `sb_publishable_` /
`sb_secret_` 格式；新舊密鑰的對應關係見文末「新版密鑰體系說明」）：

| 名稱 | 用途 | 本專案實際值 |
| --- | --- | --- |
| **Project ref** | 各 URL 的 `<ref>` | `gchpvuwgxaypiikyoxei` |
| **SUPABASE_URL** | 專案 API 位址 | `https://gchpvuwgxaypiikyoxei.supabase.co` |
| **publishable key**（新版；對應舊版 anon key） | 前端公開金鑰（可進 CI） | `sb_publishable_wnP_Vn1v6PflT3GnjsZRSQ_fPz6ugwX` |
| **secret key**（新版；對應舊版 service_role key） | 後端機密金鑰，**絕不可進前端／git**；完整 `sb_secret_...` 值請到 Dashboard → **Project Settings → API Keys** 複製 | （佔位符：`sb_secret_...`，勿寫入文件） |

---

## 2. 執行資料庫遷移（sync_ops + sync_entities）

**方式 A：SQL Editor（最簡單，建議評委用這個）**

1. Dashboard → 左側 **SQL Editor** → New query。
2. 把本 repo `supabase/migrations/0001_sync_tables.sql` 全文貼上。
3. 按 **Run**。成功會回報 `Success. No rows returned`。

**方式 B：CLI**

```powershell
supabase link --project-ref gchpvuwgxaypiikyoxei
supabase db push
```

> 遷移建立的兩張表 **RLS 已啟用但沒有任何 policy**：
> 即 anon／authenticated 一律無法直接存取，資料只能透過
> Edge Function（service_role）進出，安全性由 SYNC_TOKEN 把關。

---

## 3. 設定 Edge Function secrets

先產生一個固定的隨機 SYNC_TOKEN（記下來，評委配對要用同一個）：

```powershell
# PowerShell 產生 32 位英數隨機字串（跨 shell 可用，無 openssl 依賴）
-join ((48..57) + (97..122) | Get-Random -Count 32 | % { [char]$_ })
```

然後一次設定三個 secret：

```powershell
supabase secrets set DEEPSEEK_API_KEY=sk-... `
  SYNC_TOKEN=<固定隨機字串（上一步產生）> `
  SUPABASE_SERVICE_ROLE_KEY=<sb_secret_... 完整值>
```

> `SUPABASE_SERVICE_ROLE_KEY` 的值即第 1 步的 **secret key**（新版
> `sb_secret_...` 完整值）——只能由你從 Dashboard → **Project Settings →
> API Keys** 頁複製，本文檔不存放該值。
>
> **新密鑰體系注意**：新版專案在 Edge Function 內自動注入的環境變數
> 名稱是 `SUPABASE_SECRET_KEY`（而非 `SUPABASE_SERVICE_ROLE_KEY`）。
> 函數代碼兩者皆支援（`SUPABASE_SERVICE_ROLE_KEY` 優先），所以：
> 依上方指令手動設定 `SUPABASE_SERVICE_ROLE_KEY` 即可；若你偏好沿用
> 平台注入值，也可改設 `supabase secrets set SUPABASE_SECRET_KEY=<sb_secret_... 完整值>`，
> 效果相同。

說明：

- `DEEPSEEK_API_KEY`：AI 回覆引擎金鑰（`/api/ai/chat` 代理用）。
- `SYNC_TOKEN`：同步鑑權 + room 隔離依據。**兩台裝置必須用同一個**。
- `SUPABASE_SERVICE_ROLE_KEY`：Edge Function 內部寫 DB／發 Realtime 用。

> 想換 token：重新 `supabase secrets set SYNC_TOKEN=<新值>` 即可，
> 無需重新部署函數。

---

## 4. 部署 Edge Function

**4.1 確認專案層級 config.toml（部署前必做）**

Supabase CLI 只讀**專案層級** `supabase/config.toml` 的
`[functions.<名稱>]` section（**不會**讀函數目錄內的 config.toml）。
本 repo 已在 `supabase/config.toml` 提供該配置（內容合併自
`supabase/functions/silvercare/config.toml`，後者僅作函數目錄內的
配置記錄）。部署前請確認 `supabase/config.toml` 存在且含以下
section；若該檔被移除，可把函數目錄那份 config.toml 複製改名到
`supabase/config.toml` 還原：

```toml
[functions.silvercare]
verify_jwt = false
```

> 為什麼關 JWT 驗證：本函數自帶 SYNC_TOKEN 鑑權，且 `/api/*` 為公開
> 代理端點；前端是純 fetch，不帶 Supabase JWT。若你不想改 config.toml，
> 也可在 Dashboard → Edge Functions → silvercare → Settings 手動關閉
> JWT verification。

**4.2 部署**

```powershell
supabase functions deploy silvercare
```

成功會輸出函數 URL：`https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare`。

---

## 5. 冒煙測試（health + ai/chat）

以下指令已填入本專案實際 URL。注意：`/api/health` 與 `/api/ai/chat`
是公開端點，**無需 SYNC_TOKEN 鑑權**（只有 `/sync/*` 需要），
故以下指令不帶 Authorization 頭。

**健康檢查（PowerShell 用 Invoke-RestMethod）：**

```powershell
Invoke-RestMethod "https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare/api/health"
# 期望：回傳含 ok / service / time 的 JSON
```

**AI 對話（POST）：**

合約要求的 body 是 `{"text": "..."}`（可選 `context`），**不是**
OpenAI 式 `{"messages": [...]}`：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare/api/ai/chat" `
  -ContentType "application/json" `
  -Body '{"text":"我今朝量血壓，上壓 138 下壓 85"}'
```

**等價 curl（macOS／Linux 評委適用）：**

```bash
curl -s "https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare/api/health"

curl -s -X POST "https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"text":"我今朝量血壓，上壓 138 下壓 85"}'
```

---

## 6. GitHub：設定 CI 變數並部署 Pages

前端由 `.github/workflows/deploy-pages.yml` 自動構建，構建時注入
後端配置（Task #3 已加入 workflow）。到 GitHub repo：

**Settings → Secrets and variables → Actions**

1. **Variables** 分頁 → New repository variable：
   - Name：`VITE_SUPABASE_URL`
   - Value：`https://gchpvuwgxaypiikyoxei.functions.supabase.co/silvercare`（Edge Function 完整 base URL，結尾不加斜線）
2. **Secrets** 分頁 → New repository secret：
   - Name：`VITE_SUPABASE_ANON_KEY`
   - Value：`sb_publishable_wnP_Vn1v6PflT3GnjsZRSQ_fPz6ugwX`（新版
     publishable key，對應舊版 anon key 的角色；屬公開層級，直接寫入
     Variables 亦可，但放 Secrets 同樣可行且更保守。**絕不可**放
     `sb_secret_...` secret key）

然後 push 到 `main`（或在 Actions 頁手動 Run workflow）觸發重新部署。
workflow 會自動校驗 bundle 內已內聯 `functions.supabase.co`；
若 URL 沒設定，則輸出警告並以**純本地模式**部署（向後相容）。

> 記得 repo Settings → Pages → Source 要選「GitHub Actions」。

---

## 7. 評委配對（第二裝置同步演示）

兩台裝置各自開啟（`<token>` 換成第 3 步的 SYNC_TOKEN）：

```
https://pbs-un.github.io/SilverCareVoice/?syncToken=<token>
```

> GitHub Pages 實際路徑以你的 repo Settings → Pages 顯示為準；
> 本專案預設即上述網址。

兩台裝置用**同一個 token** 就會進入同一個 room：
長者端記錄一句話／服藥，家屬端數秒內可見（Realtime 廣播 +
3 秒輪詢雙保險）。

---

## 8. 常見問題（Troubleshooting）

| 症狀 | 原因 | 處理 |
| --- | --- | --- |
| sync 端點回 **401** | SYNC_TOKEN 錯誤或兩台裝置 token 不一致 | 確認 URL `?syncToken=` 與 `supabase secrets` 中的 `SYNC_TOKEN` 完全一致；改過 secret 後舊 token 立即失效 |
| ai/chat 回 **502／fallback** | `DEEPSEEK_API_KEY` 錯誤、過期或額度用盡 | 到 DeepSeek 平台確認 key 與餘額，`supabase secrets set DEEPSEEK_API_KEY=...` 更新 |
| 前端顯示「本地模式」，AI 用本地引擎 | CI 沒注入 `VITE_SUPABASE_URL`（變數名打錯／沒設定），前端探測降級 | 檢查 GitHub variable 名稱與值；重跑 workflow 時看「Verify backend URL inlined」步驟是否通過 |
| 家屬端收不到 **Realtime 即時通知** | Realtime 頻道未訂閱成功或專案 Realtime 未啟用 | 不影響正確性：前端 3 秒輪詢仍會收斂拿到新資料；如需即時，確認 Edge Function 廣播與 client Realtime 訂閱日誌 |
| `supabase functions deploy` 報 JWT／403 | 未 link 專案或權限不足 | 先 `supabase link --project-ref gchpvuwgxaypiikyoxei`；確認登入帳號是專案 owner |
| Dashboard 直接查表看不到資料 | RLS 無 policy（設計如此） | 屬正常安全設計；資料只能經 Edge Function 存取 |

---

## 9. 新版密鑰體系說明（sb_publishable_ / sb_secret_）

Supabase 新版 API key 體系以具前綴的密鑰取代舊版 JWT 密鑰，對應關係如下：

| 新版（本專案所用） | 舊版對應 | 層級 | 用途 |
| --- | --- | --- | --- |
| `sb_publishable_...`（publishable key） | `anon` public key | 公開 | 前端／瀏覽器使用，受 RLS 保護；本專案作 `VITE_SUPABASE_ANON_KEY` |
| `sb_secret_...`（secret key） | `service_role` key | 機密 | 後端（Edge Function）繞過 RLS 寫 DB／發 Realtime；**絕不可進前端或 git** |

對環境變數的影響（Edge Function 內平台自動注入的名稱）：

| 舊版專案注入 | 新版專案注入 | 本函數處理 |
| --- | --- | --- |
| `SUPABASE_URL` | `SUPABASE_URL` | 直接讀取 |
| `SUPABASE_ANON_KEY` | `SUPABASE_PUBLISHABLE_KEY` | 本函數未使用 anon／publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` | 兩者皆讀（`SUPABASE_SERVICE_ROLE_KEY` 優先），見 `index.ts` 中 `SERVICE_ROLE_KEY` 常數 |

因此無論你的專案屬哪種密鑰體系，只要依第 3 步設定 secret（任一名稱皆可），
函數都能正常取得 service-role 等級權限。secret key 的完整值只能從
Dashboard → **Project Settings → API Keys** 複製，任何文檔／git 一律只放佔位符。

---

## 附：相關檔案對照

| 檔案 | 用途 |
| --- | --- |
| `supabase/migrations/0001_sync_tables.sql` | sync_ops / sync_entities 建表（RLS 開、無 policy） |
| `supabase/config.toml` | **Supabase CLI 實際讀取**的專案層級配置（`[functions.silvercare] verify_jwt = false`） |
| `supabase/functions/silvercare/index.ts` | 唯一 Edge Function（health、ai/chat、sync/*） |
| `supabase/functions/silvercare/config.toml` | 函數目錄內的配置記錄（CLI 不讀取，以專案層級 config.toml 為準） |
| `.github/workflows/deploy-pages.yml` | Pages CI：注入 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 並校驗 bundle |
| `web/src/config/backend.ts` | 前端讀取上述兩變數；未設定即本地模式 |
| `supabase/.env.example` | 環境變數樣板與安全規則說明 |

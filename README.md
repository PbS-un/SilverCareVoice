# 銀髮一句通 SilverCare Macau

**澳門長者 AI 慢病照護與家庭守護平台** —— 讓長者「只說一句」，就完成健康紀錄、風險提醒與家庭守護。

> 讓長者只說一句，讓家人少一份擔心，讓健康多一份連續紀錄。

長者用一句粵語或文字（例如「我啱啱血壓 158/95，仲有啲頭暈」）說出身體狀況，系統自動完成：
意圖識別 → 結構化抽取 → 寫入健康資料庫 → 風險引擎評估 → 生成家屬提醒 → 家屬跟進回流。
全部數據由資料庫實算，沒有寫死的演示陣列。

---

## 三種運行模式

### 模式 A：GitHub Pages 純前端（Standalone）

- 只部署 `web/dist` 靜態檔，**無需任何後端**。
- 資料存於瀏覽器 **IndexedDB（Dexie）**；AI 走 **Local Hybrid Engine**（本地意圖識別＋規則引擎），離線可用。
- 適合評委一鍵體驗：打開 URL 即用，Demo Reset 可還原示範資料。
- **Demo Login**：打開即見登入頁，ID／Password 均為 `tester`（sessionStorage 保持同 session 登入）；登入後才可進入角色選擇與各功能頁。
- **四語言 UI**：繁體中文／简体中文／Português／English，登入頁與角色選擇頁即時切換、`localStorage` 保留；AI 回覆、ASR／TTS 語音跟隨所選語言。
- **Elder 自動朗讀**：長者端 AI 回答完成後自動朗讀一次（TTS 跟隨語言）；重新渲染／歷史載入／返回頁面不會重播，手動播放按鈕保留。

### 模式 B：本地雙裝置（Sync Server + DeepSeek Proxy）

- `server/`（埠 **8787**）提供：
  - **AI Proxy**：`POST /api/ai/chat` —— DeepSeek API Key 只存後端（`server/.env`），絕不下發前端；無 Key 時自動回 `provider:'local'`，前端確定性走 Local Hybrid Engine。
  - **雙裝置同步**：`/sync/bootstrap`、`/sync/pull`、`/sync/push` + WebSocket `/ws`，SQLite 中繼，長者手機與家屬電腦在區網內實時同步。同步端點使用配對 token（見 server/README.md）。
- 前端 `vite dev`（5173）已配置 `/api`、`/sync`、`/ws` 代理至 8787；dev server 已監聽 `0.0.0.0`（`host: true`），第二裝置（如長者手機）在區網內用 `http://<電腦 LAN IP>:5173` 即可訪問，毋需額外配置。

### 模式 C：雲端全功能演示（Supabase）

- **公開連結**：<https://pbs-un.github.io/SilverCareVoice/> —— GitHub Pages 前端＋Supabase 雲端後端，承載**全部功能**：
  - **真 DeepSeek AI**：經 Edge Function 代理（`/api/ai/chat`），API Key 只存 Supabase secrets，絕不下發前端。
  - **雙裝置跨網同步**：Postgres op-log／LWW（`/sync/*`）＋ Realtime 廣播，無需同一區網，互聯網任意兩台裝置皆可實時同步。
- 雲端後端由 `supabase/functions/silvercare`（單一 Edge Function，提供 `/api/health`、`/api/ai/chat`、`/sync/*`）與 `supabase/migrations/0001_sync_tables.sql`（sync_ops／sync_entities）構成；前端構建時注入 `VITE_SUPABASE_URL`／`VITE_SUPABASE_ANON_KEY` 即開啟雲端模式（見 `web/src/config/backend.ts`，未注入則自動降級為本地模式，向後相容）。CI workflow 已預留 env 注入與 bundle 校驗。
- **評委第二裝置配對**：第二台裝置瀏覽器開啟
  `https://pbs-un.github.io/SilverCareVoice/?syncToken=<token>`
  （`<token>` 即部署時設定的 SYNC_TOKEN；兩台裝置帶同一 token 即進入同一 room，長者端記錄一句，家屬端數秒內可見。token 只需帶一次，web 端自動存入 localStorage）。
- **部署／重建步驟**：完整指引見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)（CLI 安裝、資料庫遷移、secrets、Edge Function 部署、GitHub CI 變數、評委配對與故障排查）。
- **驗證狀態**：本地全量測試通過（Vitest 285 cases＋Playwright E2E 16 cases）；雲端線上驗證待完成 Supabase 部署與 GitHub vars 設定後生效。

---

## 快速開始

需求：Node ≥ 18.17、npm。Windows PowerShell 請用 `;` 代替 `&&`。

```powershell
# 1. 安裝所有 workspace 依賴
npm install

# 2a. 只起前端（模式 A，純本地 IndexedDB）
npm run dev            # http://localhost:5173

# 2b. 前後端同時起（模式 B）
npm run dev:all        # server 8787 + web 5173

# 3.（模式 B 可選）啟用真實 DeepSeek AI
#    建立 server/.env（參考 server/.env.example），填入：
#    DEEPSEEK_API_KEY=sk-xxxx
#    重啟 server 即生效；不填則全程離線本地模式。
```

打開 http://localhost:5173 → Demo Login（tester / tester）→ 選擇「我是長者」或「我是家人」。

### Seed 與 Demo Reset

- **首次啟動**：資料庫為空時自動 seed 示範資料（陳婆婆、7 日血壓／血糖、藥物、覆診、seed 提醒、31 篇澳門長者知識庫文檔）。
- **Demo Reset**：角色選擇頁底部「Demo 重置」按鈕，一鍵清除並還原示範資料（評委演示前後皆可用）。

---

## 常用命令

| 命令 | 說明 |
| --- | --- |
| `npm run dev` | 前端 dev server（5173） |
| `npm run dev:server` | 後端 server（8787） |
| `npm run dev:all` | 前後端同時啟動 |
| `npm run build` | 構建前端（tsc --noEmit + vite build → web/dist） |
| `npm test` | 單元測試（Vitest，實測 17 files / 285 cases） |
| `npm run test:e2e` | E2E 測試（Playwright，16 cases） |
| `node scripts/generate-pdf.mjs` | 生成項目簡報 PDF（≤5 頁 A4，內含實機截圖） |
| `node scripts/generate-pdf.mjs --url <URL>` | 發布後重生成 PDF（真實 URL + QR Code） |
| `node scripts/generate-video.mjs` | 錄製 60–120 秒真實操作 Demo 影片（webm） |
| `node scripts/deploy-pages.mjs` | 構建並提交到**本地** gh-pages branch（不 push） |

---

## 交付產物（T11）

| 產物 | 路徑 | 生成方式 |
| --- | --- | --- |
| 項目簡報 PDF（5 頁 A4） | `deliverables/銀髮一句通_項目簡報.pdf` | `node scripts/generate-pdf.mjs` |
| Demo 影片（真實操作、不剪接） | `deliverables/demo.webm` | `node scripts/generate-video.mjs` |
| GitHub Pages 部署 | <https://pbs-un.github.io/SilverCareVoice/>（已上線）＋`.github/workflows/deploy-pages.yml` | `node scripts/deploy-pages.mjs`／CI 自動部署 |

> PDF 與 QR 的公開 URL 已更新為正式連結 <https://pbs-un.github.io/SilverCareVoice/>；
> 如 URL 變動，執行 `node scripts/generate-pdf.mjs --url <公開URL>` 即可一條命令重生成。

---

## 系統架構（簡）

```
長者一句輸入（語音 ASR / 文字）
      │
      ▼
Safety Layer（緊急／敏感攔截）→ Intent / Extraction（意圖＋結構化抽取）
      │
      ▼
AI Provider：DeepSeek（經本地 proxy，Key 只在後端）
             ＋ Knowledge Base（31 篇澳門長者政策/健康/服務文檔）
             ＋ Local Hybrid Engine（離線 fallback，無 Key 必走）
      │
      ▼
Repository → Database：IndexedDB（前端，Dexie）＋ SQLite（同步中繼）
      │
      ▼
Risk Rules → HealthEvent → Alert → 家屬端提醒 → 已跟進 → 回流紀錄
```

路由：`/`（角色選擇）・`/elder`、`/elder/health`（長者端）・`/family`、`/family/health`、`/family/alerts`、`/family/report`（家屬端）・`/insights`（數據洞察）・`/report`（A4 可打印報告）・`/print-brief`（項目簡報打印頁）。

---

## 目錄結構

```
├── web/                  # 前端：Vite + React 18 + TypeScript + Tailwind
│   ├── src/pages/        # 九個頁面（長者×2、家屬×4、洞察、報告、簡報）
│   ├── src/core/         # assistant（AI 管線）、kb（知識庫）、rules（風險引擎）
│   ├── src/data/         # DataProvider（IndexedDB/Supabase）+ sync client
│   ├── src/services/     # Alert / Report / Insight / speech（ASR/TTS）
│   └── e2e/              # Playwright E2E
├── server/               # 後端：Node ESM（Express + WS + SQLite），埠 8787
│   ├── ai/               # DeepSeek 客戶端
│   ├── routes/           # AI proxy 路由
│   └── sync/             # 雙裝置同步（hub/routes/db）
├── scripts/              # T11 交付腳本（PDF/影片/Pages）
├── deliverables/         # 產出之 PDF 與影片
├── .github/workflows/    # GitHub Pages 部署 workflow（push 後生效）
├── README.md / THIRD_PARTY.md / DELIVERY.md
└── supabase/             # Supabase 雲端後端（模式 C）：Edge Function、遷移、DEPLOYMENT.md 部署指引
```

---

## 合規聲明

- 本原型之內嵌 **Demo triage rules（分診／風險規則）僅供演示，並非醫療標準**，不構成任何醫療建議或診斷；實際照護決策必須由專業醫護人員作出。
- 進入長者／家屬端前必須先經免責同意畫面（Consent）；對話、提醒、跟進全數留痕（Audit）。
- API Key 只存後端環境變數（`server/.env`，已 gitignore），絕不進 git、絕不下發前端。
- 第三方依賴與授權詳見 [THIRD_PARTY.md](./THIRD_PARTY.md)；交付清單與驗證結果詳見 [DELIVERY.md](./DELIVERY.md)。

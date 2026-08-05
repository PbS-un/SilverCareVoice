# 銀髮一句通 SilverCare Macau — 交接文檔

> **項目全稱**：銀髮一句通 SilverCare Macau — 澳門長者 AI 慢病照護與家庭守護平台
> **交接日期**：2026-08-05
> **倉庫**：`SilverCareVoice`（npm monorepo，workspaces: `web` + `server`）
> **線上示範**：<https://pbs-un.github.io/SilverCareVoice/>

---

## 一、項目概述

長者用一句粵語或文字（例如「我啱啱血壓 158/95，仲有啲頭暈」）說出身體狀況，系統自動完成：

```
意圖識別 → 結構化抽取 → 寫入健康資料庫 → 風險引擎評估 → 生成家屬提醒 → 家屬跟進回流
```

全部數據由資料庫實算，沒有寫死的演示陣列。

### 核心賣點

1. **澳門 × 極簡**：粵語語音＋繁體中文，長者只需一句話
2. **慢病 × 家庭**：血壓／血糖／用藥自動記錄，異常即推送家屬提醒
3. **數據 × 長期價值**：全部數據從 IndexedDB / Postgres 實算，趨勢圖、週報、A4 打印報告

---

## 二、三種運行模式

| 模式 | 後端 | 資料存儲 | AI 引擎 | 適用場景 |
| --- | --- | --- | --- | --- |
| **A：純前端** | 無 | 瀏覽器 IndexedDB（Dexie） | Local Hybrid Engine（離線） | 評委一鍵體驗 |
| **B：本地雙裝置** | Node server（埠 8787） | IndexedDB + SQLite 中繼 | DeepSeek（Key 存 server/.env）或 Local fallback | 區網內雙裝置演示 |
| **C：雲端全功能** | Supabase Edge Function | IndexedDB + Postgres op-log/LWW | DeepSeek（Key 存 Supabase secrets）或 Local fallback | 互聯網跨網演示 |

### 模式自動降級邏輯

- 前端啟動時探測後端（`GET /api/health`，~2s 超時）
- 可達 → 啟用同步；不可達 → standalone 純 IndexedDB
- 雲端模式由構建時 `VITE_SUPABASE_URL` 決定，runtime 不可切換
- 無 DeepSeek Key → 全程 Local Hybrid Engine（確定性離線模式）

---

## 三、技術架構

### 3.1 前端（`web/`）

| 技術 | 版本 | 用途 |
| --- | --- | --- |
| Vite | ^5.4.8 | 構建與 dev server |
| React | ^18.3.1 | UI 框架 |
| TypeScript | ^5.6.2 | 型別檢查 |
| Tailwind CSS | ^3.4.13 | 原子化 CSS |
| Dexie | ^4.0.8 | IndexedDB 封裝（本地優先資料庫） |
| react-router-dom | ^6.26.2 | HashRouter 路由 |
| recharts | ^2.12.7 | 血壓／血糖／趨勢圖表 |
| fuse.js | ^7.0.0 | 知識庫模糊搜尋（31 篇澳門長者文檔） |
| zod | ^3.23.8 | AI 結構化輸出 schema 校驗 |
| lucide-react | ^0.451.0 | 圖示 |
| @supabase/supabase-js | ^2.109.0 | Supabase Realtime 連線（雲端模式） |

### 3.2 後端（`server/`）

| 技術 | 版本 | 用途 |
| --- | --- | --- |
| Node.js ESM | ≥18.17 | 運行環境 |
| Express | ^4.21.0 | HTTP 框架（AI proxy + sync API） |
| ws | ^8.18.0 | WebSocket（雙裝置即時同步廣播） |
| better-sqlite3 | ^11.3.0 | SQLite（同步中繼資料庫，WAL 模式） |
| dotenv | ^16.4.5 | 讀取 server/.env |
| zod | ^3.23.8 | 同步 payload / AI 輸出校驗 |

### 3.3 雲端後端（`supabase/`）

| 組件 | 說明 |
| --- | --- |
| `supabase/functions/silvercare/index.ts` | 單一 Edge Function（Deno），提供 `/api/health`、`/api/ai/chat`、`/sync/*` |
| `supabase/migrations/0001_sync_tables.sql` | sync_ops / sync_entities 建表（RLS 開、無 policy） |
| `supabase/config.toml` | 專案層級配置（`verify_jwt = false`） |

### 3.4 數據流架構

```
長者一句輸入（語音 ASR / 文字）
      │
      ▼
Safety Layer（緊急／敏感攔截，12 個高風險關鍵詞）
      │
      ▼
Intent / Extraction（意圖識別＋結構化抽取）
      │
      ▼
AI Provider：DeepSeek（經 proxy，Key 只在後端）
             ＋ Knowledge Base（31 篇澳門長者政策/健康/服務文檔）
             ＋ Local Hybrid Engine（離線 fallback，無 Key 必走）
      │
      ▼
Repository → Database：IndexedDB（前端 Dexie）＋ Postgres（雲端）＋ SQLite（本地 server）
      │
      ▼
Risk Rules → HealthEvent → Alert → 家屬端提醒 → 已跟進 → 回流紀錄
```

---

## 四、目錄結構與關鍵檔案

```
SilverCareVoice/
├── web/                          # 前端
│   ├── src/
│   │   ├── pages/                # 九個頁面
│   │   │   ├── RoleSelect.tsx    # 角色選擇（/）
│   │   │   ├── ElderHome.tsx     # 長者首頁（/elder）
│   │   │   ├── ElderHealth.tsx   # 長者健康記錄（/elder/health）
│   │   │   ├── FamilyHome.tsx    # 家屬首頁（/family）
│   │   │   ├── FamilyHealth.tsx  # 家屬健康趨勢（/family/health）
│   │   │   ├── FamilyAlerts.tsx  # 提醒列表（/family/alerts）
│   │   │   ├── FamilyReport.tsx  # 週報（/family/report）
│   │   │   ├── InsightsPage.tsx  # 數據洞察（/insights）
│   │   │   ├── ReportPage.tsx    # A4 可打印報告（/report）
│   │   │   └── PrintBrief.tsx    # 項目簡報打印頁（/print-brief）
│   │   ├── core/
│   │   │   ├── assistant/        # AI 管線
│   │   │   │   ├── AssistantService.ts   # 助理主服務
│   │   │   │   ├── DeepSeekClient.ts     # DeepSeek API 客戶端
│   │   │   │   ├── LocalHybridEngine.ts  # 離線本地引擎
│   │   │   │   ├── extraction.ts         # 結構化抽取
│   │   │   │   ├── intent.ts             # 意圖識別
│   │   │   │   └── safetyScreen.ts       # 安全篩查
│   │   │   ├── kb/search.ts      # 知識庫搜尋（Fuse.js）
│   │   │   └── rules/HealthRuleEngine.ts # 風險規則引擎
│   │   ├── data/
│   │   │   ├── DataProvider.ts   # 資料層統一接口（singleton）
│   │   │   ├── IndexedDBProvider.ts      # IndexedDB 實作
│   │   │   ├── SupabaseProvider.ts       # Supabase 實作（stub）
│   │   │   ├── sync/            # 同步模組
│   │   │   │   ├── SyncClient.ts         # 同步客戶端
│   │   │   │   ├── outbox.ts             # Outbox + SyncedProvider
│   │   │   │   └── wire.ts              # 線協議
│   │   │   ├── seed.ts           # 種子資料
│   │   │   ├── demoReset.ts      # Demo 重置
│   │   │   └── knowledgeBase.ts  # 知識庫文檔
│   │   ├── services/
│   │   │   ├── AlertService.ts   # 提醒服務
│   │   │   ├── ReportService.ts  # 報告服務
│   │   │   ├── InsightService.ts # 洞察服務
│   │   │   └── speech/           # ASR（語音辨識）+ TTS（語音合成）
│   │   ├── config/backend.ts     # 後端位址配置（本地/雲端模式切換）
│   │   ├── types/entities.ts     # 19 個核心實體定義
│   │   ├── components/           # UI 組件（Modal、BottomNav、VoiceConfirmCard 等）
│   │   └── App.tsx               # 根元件（路由 + 啟動流程）
│   ├── e2e/                      # Playwright E2E 測試（16 cases）
│   └── vite.config.ts            # Vite 配置（proxy、test）
│
├── server/                       # 後端（本地開發用）
│   ├── index.mjs                 # 入口（Express + WS，埠 8787）
│   ├── ai/deepseek.mjs           # DeepSeek 客戶端
│   ├── routes/assist.mjs         # AI proxy 路由
│   ├── sync/                     # 雙裝置同步
│   │   ├── hub.mjs               # WebSocket hub
│   │   ├── routes.mjs            # 同步路由
│   │   └── db.mjs                # SQLite 操作
│   └── .env.example              # 環境變數範本
│
├── supabase/                     # 雲端後端
│   ├── functions/silvercare/     # Edge Function（Deno）
│   ├── migrations/               # 資料庫遷移
│   ├── DEPLOYMENT.md             # 部署指引（詳細）
│   └── config.toml               # CLI 配置
│
├── scripts/                      # 交付腳本
│   ├── generate-pdf.mjs          # PDF 生成（≤5 頁 A4）
│   ├── generate-video.mjs        # Demo 影片錄製（60-120s webm）
│   └── deploy-pages.mjs          # GitHub Pages 部署
│
├── deliverables/                 # 交付產物
│   ├── 銀髮一句通_項目簡報.pdf    # 5 頁 A4 簡報
│   └── demo.webm                 # ~65 秒 Demo 影片
│
├── .github/workflows/            # CI/CD
│   └── deploy-pages.yml          # GitHub Pages 部署 workflow
│
├── package.json                  # Monorepo 根配置
├── README.md                     # 項目說明
├── DELIVERY.md                   # 交付說明與驗證清單
└── THIRD_PARTY.md                # 第三方依賴清單
```

---

## 五、19 個核心實體

| 實體 | 表名 | 說明 |
| --- | --- | --- |
| User | users | 系統用戶 |
| ElderProfile | elderProfiles | 長者檔案 |
| Caregiver | caregivers | 照顧者（家人） |
| CaregiverLink | caregiverLinks | 長者↔照顧者授權關係 |
| ChronicCondition | chronicConditions | 慢病 |
| VitalRecord | vitalRecords | 生命徵象（血壓／血糖／心率／體重） |
| Medication | medications | 藥物 |
| MedicationLog | medicationLogs | 服藥記錄 |
| SymptomRecord | symptomRecords | 症狀記錄 |
| Appointment | appointments | 覆診／預約 |
| HealthEvent | healthEvents | 健康事件（規則/AI 推論） |
| Alert | alerts | 照顧者提醒 |
| CaregiverFollowUp | caregiverFollowUps | 跟進記錄 |
| Conversation | conversations | 對話訊息 |
| ServiceQuery | serviceQueries | 服務查詢 |
| Consent | consents | 同意記錄 |
| AuditLog | auditLogs | 審計日誌 |
| ResourceDirectory | resourceDirectory | 社區資源目錄 |
| KnowledgeDocument | knowledgeDocuments | 知識庫文檔 |

---

## 六、常用命令

### 開發

```powershell
# 安裝全部依賴
npm install

# 只起前端（模式 A）
npm run dev              # http://localhost:5173

# 前後端同時起（模式 B）
npm run dev:all          # server 8787 + web 5173

# 只起後端
npm run dev:server       # http://localhost:8787
```

### 測試

```powershell
# 單元測試（Vitest，445 cases）
npm test

# E2E 測試（Playwright，16 cases）
npm run test:e2e
```

### 構建與部署

```powershell
# 構建前端（tsc --noEmit + vite build → web/dist）
npm run build

# 生成項目簡報 PDF
node scripts/generate-pdf.mjs
node scripts/generate-pdf.mjs --url <公開URL>    # 含真實 QR Code

# 錄製 Demo 影片
node scripts/generate-video.mjs

# 部署到 GitHub Pages（本地 gh-pages branch，不 push）
node scripts/deploy-pages.mjs
```

---

## 七、環境變數配置

### 7.1 本地後端（`server/.env`，已 gitignore）

| 變數 | 必需 | 說明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 否 | 留空 → 全程 Local Hybrid Engine |
| `DEEPSEEK_BASE_URL` | 否 | 預設 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 否 | 預設 `deepseek-chat` |
| `PORT` | 否 | 預設 `8787` |
| `SYNC_TOKEN` | 否 | 留空 → 自動生成並打印到啟動日誌 |

### 7.2 雲端模式（GitHub CI 變數）

| 變數 | 類型 | 說明 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Variable | Edge Function base URL（`https://<ref>.functions.supabase.co/silvercare`） |
| `VITE_SUPABASE_ANON_KEY` | Secret | Supabase publishable key（`sb_publishable_...`） |

### 7.3 Supabase Edge Function Secrets

| Secret | 說明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | AI 引擎金鑰 |
| `SYNC_TOKEN` | 同步配對 token（兩台裝置必須用同一個） |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role 密鑰（`sb_secret_...`） |

---

## 八、AI 管線詳情

### 8.1 意圖識別（13 種 intent）

`symptom` | `vital_record` | `medication_taken` | `medication_missed` | `appointment_query` | `health_history` | `policy_query` | `medical_resource_query` | `family_contact` | `family_status_query` | `emergency` | `general_health_question` | `unknown`

### 8.2 AI Provider 優先級

1. **Safety Layer**：12 個高風險關鍵詞（胸痛、暈倒、昏迷等）→ 直接攔截，不走 LLM
2. **DeepSeek**：經 proxy 調用，Key 只在後端，輸出經 zod schema 校驗
3. **Local Hybrid Engine**：無 Key / LLM 失敗 / 離線時 → 確定性本地規則引擎

### 8.3 AI 輸出結構

```typescript
{
  intent: string,          // 13 種之一
  riskLevel: string,       // 'normal' | 'attention' | 'urgent'
  answer: string,          // 繁體中文，最多 2 句
  detailedAnswer?: string, // 可選詳細回答
  extractedData?: {        // 結構化抽取結果
    bloodPressure?: { systolic, diastolic },
    bloodGlucose?: number,
    heartRate?: number,
    weight?: number,
    symptoms?: string[],
    medicationName?: string,
    medicationStatus?: 'taken' | 'missed' | 'late',
    medicationDoseAmount?: number | string,
    medicationDoseUnit?: string,
    appointment?: { date, time, location, department, doctor, timeTbd }
  },
  actions?: string[]       // 建議行動
}
```

---

## 九、同步協議

### 9.1 架構

- **Op-log + LWW**（Last-Writer-Wins）
- 同步游標用 server 端單調遞增 `seq`（非客戶端時間戳）
- Room 隔離：`SHA-256(SYNC_TOKEN)` 前 16 hex
- 確定性 tiebreaker：`updatedAt` 平手時 `deviceId` 字典序較大者勝

### 9.2 端點

| 端點 | 方法 | 說明 |
| --- | --- | --- |
| `/sync/bootstrap` | GET | 首次加入，取得全部當前狀態 + cursor |
| `/sync/pull?since=<seq>` | GET | 增量拉取（單頁上限 1000 筆） |
| `/sync/push` | POST | 推送 ops（回傳 applied/rejected/duplicated） |
| `/ws` | WebSocket | 即時廣播（change 事件） |

### 9.3 鑑權

- `/sync/*` 需要 `Authorization: Bearer <SYNC_TOKEN>` 或 `?token=<SYNC_TOKEN>`
- 雲端模式：sync token 以 query `?token=` 附帶（因 Authorization 被 anon key 佔用）
- WS `hello` 需帶 `token` 欄位

---

## 十、測試覆蓋

### 10.1 單元測試（Vitest）

- **23 個測試檔案，445 個測試案例**
- 覆蓋：AssistantService、extraction、safetyScreen、HealthRuleEngine、kb/search、DataProvider、AlertService、ReportService、InsightService、ASR、TTS、doseFormat、medicationSearch、textMatch 等

### 10.2 E2E 測試（Playwright）

- **16 個測試案例**
- 覆蓋：ui-smoke、flagship（血壓偏高→家屬提醒）、persistence、routes、medication-report、voice-actions、family-loop 等

### 10.3 已知限制

- ASR/TTS 依賴 Web Speech API（Chromium 系最佳）；不支援時自動 fallback 文字輸入
- Demo triage rules 僅供演示，非醫療標準
- DeepSeek 需自備 Key；無 Key 時全程本地引擎
- 影片為實時錄製（432×936，無後製剪接）

---

## 十一、部署狀態

| 項目 | 狀態 |
| --- | --- |
| GitHub Pages | **已上線**：<https://pbs-un.github.io/SilverCareVoice/> |
| CI workflow | 已配置（push main/master 觸發自動部署） |
| Supabase 雲端後端 | 代碼已就緒，本地全量測試通過；線上驗證待部署 |
| 本地 Node server | 可用（模式 B） |
| PDF 簡報 | 已生成（5 頁 A4） |
| Demo 影片 | 已錄製（~65 秒） |

---

## 十二、Supabase 部署步驟摘要

詳細步驟見 `supabase/DEPLOYMENT.md`，摘要如下：

1. **安裝 Supabase CLI**：`npm i -g supabase` → `supabase login`
2. **執行資料庫遷移**：Dashboard → SQL Editor → 貼上 `supabase/migrations/0001_sync_tables.sql`
3. **設定 Edge Function secrets**：
   ```powershell
   supabase secrets set DEEPSEEK_API_KEY=sk-... SYNC_TOKEN=<隨機字串> SUPABASE_SERVICE_ROLE_KEY=<sb_secret_...>
   ```
4. **部署 Edge Function**：`supabase functions deploy silvercare`
5. **設定 GitHub CI 變數**：Settings → Secrets and variables → Actions
   - Variable: `VITE_SUPABASE_URL` = Edge Function URL
   - Secret: `VITE_SUPABASE_ANON_KEY` = `sb_publishable_...`
6. **Push 觸發 CI** → 自動重新部署 GitHub Pages

### 評委配對

兩台裝置開啟：`https://pbs-un.github.io/SilverCareVoice/?syncToken=<token>`

---

## 十三、安全與合規

1. **API Key 安全邊界**：DeepSeek Key 只存後端環境變數（`server/.env` / Supabase secrets），絕不進 git、絕不下發前端
2. **Consent 機制**：進入長者/家屬端前強制免責同意畫面
3. **Audit 留痕**：對話、提醒、跟進全數留痕
4. **RLS 安全設計**：Supabase 兩張 sync 表 RLS 已啟用但無 policy，資料只能經 Edge Function（service_role）進出
5. **醫療免責**：內嵌 triage rules 僅供演示，非醫療標準，不構成醫療建議

---

## 十四、密鑰體系說明

本專案使用 Supabase **新版密鑰體系**：

| 新版 | 舊版對應 | 層級 | 用途 |
| --- | --- | --- | --- |
| `sb_publishable_...` | anon key | 公開 | 前端使用（`VITE_SUPABASE_ANON_KEY`） |
| `sb_secret_...` | service_role key | 機密 | Edge Function 內部使用，**絕不可進前端/git** |

Edge Function 內環境變數名稱：
- 舊版專案自動注入 `SUPABASE_SERVICE_ROLE_KEY`
- 新版專案自動注入 `SUPABASE_SECRET_KEY`
- 函數代碼兩者皆支援（`SUPABASE_SERVICE_ROLE_KEY` 優先）

---

## 十五、常見問題

| 問題 | 原因 | 解決 |
| --- | --- | --- |
| 前端顯示「本地模式」 | CI 沒注入 `VITE_SUPABASE_URL` | 檢查 GitHub variable 名稱與值 |
| sync 端點回 401 | SYNC_TOKEN 錯誤 | 確認 URL `?syncToken=` 與 secrets 中一致 |
| AI 回 502/fallback | DeepSeek Key 錯誤或額度用盡 | 確認 key 與餘額 |
| ASR 不支援 | 瀏覽器不支援 Web Speech API | 自動隱藏麥克風，文字輸入常駐 |
| Dashboard 查表看不到資料 | RLS 無 policy（設計如此） | 屬正常安全設計 |

---

## 十六、下一步建議

1. **完成 Supabase 雲端部署驗證**：按 `supabase/DEPLOYMENT.md` 完成部署，線上驗證全功能
2. **生產級安全強化**：
   - 替換單一靜態 SYNC_TOKEN 為 per-user 動態 token
   - 加入 TLS（HTTPS）保護 LAN 通訊
   - 考慮加入 Supabase Auth 做用戶認證
3. **功能擴展**：
   - 接入真實澳門醫療資源 API
   - 擴展知識庫文檔
   - 加入藥物相互作用檢查
   - 支持更多語言（英語、普通話）
4. **效能優化**：
   - IndexedDB 大量數據時的虛擬滾動
   - 同步衝突的可視化提示
5. **合規完善**：
   - 私隱政策聲明
   - 數據保留策略
   - 用戶數據導出/刪除功能

---

## 十七、相關文檔索引

| 文檔 | 路徑 | 說明 |
| --- | --- | --- |
| 項目說明 | `README.md` | 完整繁體中文說明 |
| 交付說明 | `DELIVERY.md` | 交付清單與驗證結果 |
| 第三方依賴 | `THIRD_PARTY.md` | 全部依賴清單與授權 |
| Server 說明 | `server/README.md` | 本地 server API 文檔 |
| Supabase 部署 | `supabase/DEPLOYMENT.md` | 雲端後端部署指引 |
| 知識庫說明 | `web/src/core/kb/README.md` | 知識庫搜尋說明 |
| 同步說明 | `web/src/data/sync/README.md` | 同步模組說明 |
| Speech 說明 | `web/src/services/speech/README.md` | ASR/TTS 說明 |

---

## 十八、聯絡與支援

- **項目倉庫**：GitHub `PbS-un/SilverCareVoice`
- **線上示範**：<https://pbs-un.github.io/SilverCareVoice/>
- **技術棧**：Vite + React 18 + TypeScript + Tailwind + Dexie + Express + WS + SQLite + Supabase Edge Function + DeepSeek

---

*本文檔由項目代碼與現有文檔整理而成，如有疑問請參閱對應的詳細文檔或源碼註釋。*

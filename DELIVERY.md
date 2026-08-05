# DELIVERY.md — 銀髮一句通 SilverCare Macau 交付說明

交付任務：T11（PDF／影片／README／Pages 發布準備）。
本文件所有 Verification 結果均為本機實測（2026-08-05，Windows / Node 18+），未實測項一律標 PENDING。

---

## 1. 交付概覽

| 項目 | 狀態／值 |
| --- | --- |
| Functional Prototype URL | **已發布**：<https://pbs-un.github.io/SilverCareVoice/>（GitHub Pages 已上線；完成 Supabase 部署並設好 GitHub vars 後，該連結承載 100% 雲端功能——真 DeepSeek＋跨網雙裝置同步，見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)） |
| GitHub Pages | **已上線**（`.github/workflows/deploy-pages.yml`；CI 已預留 `VITE_SUPABASE_URL`／`VITE_SUPABASE_ANON_KEY` 注入與 bundle 校驗） |
| Release Branch | 本地 `gh-pages`（orphan branch）已建立，commit `a5c73e1`，內容為 `web/dist` 完整構建產物＋`.nojekyll` |
| Backend | ① **Supabase 雲端後端（生產演示）**：Edge Function `supabase/functions/silvercare`（`/api/health`、`/api/ai/chat`、`/sync/*`）＋ Postgres op-log／LWW（`supabase/migrations/0001_sync_tables.sql`）＋ Realtime 廣播；部署指引見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)。② Local Node Sync Server（埠 8787）：AI Proxy（DeepSeek）＋雙裝置同步（HTTP + WebSocket + SQLite），定位為本地開發／合約參照實現。同步端點皆使用配對 token（見 server/README.md） |
| AI | DeepSeek（雲端經 Edge Function 代理，Key 只存 Supabase secrets；本地經 proxy，Key 只存 `server/.env`）＋ **Local Hybrid Engine 離線 fallback**（無 Key／離線／未配置雲端時全本地運行） |
| Database | IndexedDB（Dexie，前端本地優先）＋ Postgres（雲端同步中繼，sync_ops／sync_entities）＋ SQLite（本地 server 同步中繼） |

## 2. 功能清單

### 本輪新增（T1 四語言／T2 自動朗讀／T3 Demo Login）
- **Demo Login**：登入頁（tester / tester），sessionStorage 保持登入；未登入訪問受保護路由導向登入頁；`/print-brief` 保留公開例外（PDF 生成用）。
- **四語言 UI**：繁體中文／简体中文／Português／English；登入頁與角色選擇頁即時切換、`localStorage` 持久化；AI 回覆（DeepSeek prompt + Local Hybrid 本地化）、ASR／TTS（zh-HK／zh-CN／pt-PT／en-US）跟隨語言。
- **Elder AI 自動朗讀**：每條新 assistant final answer 自動播放一次（exactly once）；rerender／歷史載入／語言切換／返回頁面不重播；手動播放保留。

### 老人端（/elder、/elder/health）
- 大麥克風語音輸入（ASR，4 狀態色）＋文字輸入（≥24px）雙通道
- 一句輸入 → AI 回答氣泡（TTS 播放／再講多啲／provider 標記／免責提示）
- 快捷鍵：量血壓／記錄食藥／搵家人（全部真寫庫）
- 今日狀態卡（DB 實算：異常事件數＋「家人已經知道」）
- 歷史對話、我的記錄（血壓圖表、覆診、用藥）
- 緊急模式（urgent：紅色全屏＋通知家人＋999/112）

### 家屬端（/family、/family/health、/family/alerts、/family/report）
- 今日總覽（今日血壓、需注意事項數）
- 健康趨勢：血壓雙線圖＋血糖圖（7／30 日切換，vitalsBetween 真查詢）＋六表合併時間線
- 提醒列表：severity 分色、知道了／已跟進（跟進方式＋備註 → CaregiverFollowUp）
- 週報：AI 摘要＋統計＋建議（DB 實算）

### 數據洞察與報告（/insights、/report、/print-brief）
- Insights 儀表板（關鍵數字＋三圖表）
- A4 可打印總報告（/report，data-testid: print-report）
- 項目簡報打印頁（/print-brief，本交付新增，A4×5 頁）

### 知識庫與安全
- 31 篇澳門長者文檔（政策／健康／服務）模糊搜尋（Fuse.js）
- Safety Layer：緊急／敏感情境攔截，唔行 LLM
- Consent：進入長者／家屬端前強制免責同意

## 3. 交付檔案

| 檔案 | 說明 |
| --- | --- |
| `deliverables/銀髮一句通_項目簡報.pdf` | **5 頁 A4**（pdf-lib 實測頁數 = 5，符合 ≤5 頁；595×842pt 標準 A4），內含 3 張實機 UI 截圖；URL/QR 為正式連結 <https://pbs-un.github.io/SilverCareVoice/> |
| `deliverables/demo.webm` | Demo 影片，**實測時長約 96 秒**（目標 60–120 秒），含旁白音軌（VP9+Opus）與燒入繁體中文字幕，真實操作不剪接 |
| `deliverables/demo.mp4` | 可選 H.264+AAC 版本（同內容） |
| `deliverables/demo.srt` | 字幕 source（繁體中文） |
| `deliverables/demo-narration.txt` | 旁白逐字稿（narrated voice-over，Windows SAPI zh-HK 合成，非真人錄音） |
| `README.md` | 完整繁體中文說明（三種模式——A 純前端／B 本地全棧／C Supabase 雲端、快速開始、命令、架構、合規聲明） |
| `THIRD_PARTY.md` | 全部依賴清單（License 以 node_modules 實查核對） |
| `scripts/generate-pdf.mjs` | PDF 生成腳本（支持 `--url <URL>` 重生成含真實 QR 版本） |
| `scripts/generate-video.mjs` | 影片錄製腳本（Playwright recordVideo） |
| `scripts/deploy-pages.mjs` | 本地 gh-pages 部署腳本（git worktree，可重複執行，**明確不 push**） |
| `.github/workflows/deploy-pages.yml` | GitHub Pages workflow（push 後生效） |
| `web/src/pages/PrintBrief.tsx` | 簡報打印頁（路由 /print-brief） |

### PDF 頁面結構（5 頁，T1 更新）
1. **價值主張**：銀髮一句通 SilverCare Macau／澳門長者 AI 慢病照護與家庭守護平台／核心句／三項產品特點（一句即用、家庭閉環、多語澳門）
2. **三項核心創新**：一句話完成健康互動（Speak once→Respond，含 AI 回答後自動朗讀）、家庭照護閉環（Elder→Continuous Record）、澳門四語言場景；實機截圖（/elder 回答氣泡＋/family/alerts）
3. **技術棧與架構**：Frontend/Data/AI/Cloud/Local Sync/Voice/Engineering 八欄；三種運行模式（A/B/C）；Voice→Safety→AI+Local Hybrid→Data→Risk→Alert 架構；/family/health 血壓圖實機截圖
4. **競品類別比較**：Health Tracking App／AI Voice Assistant／Wearable／SilverCare 能力表（✓/△），核心論點
5. **未來願景**：NOW／NEXT（明確標示 future）／FUTURE；正式 URL＋QR＋Demo Login（tester/tester）

### Demo 影片內容（真實操作、不剪接，96 秒）
Demo Login（tester/tester）→ 四語言切換 → Demo Reset → 同意頁 → /elder 輸入「我啱啱血壓158/95，仲有啲頭暈」→ 回答氣泡與自動 TTS → 今日狀態 → 快捷量血壓新增 162/98 → /family/health 圖表新點 → /family/alerts 新 Alert → 已跟進（上門＋備註）→ 回 /elder 見「家人已經知道 ✓」→ 結尾（三項重點＋正式 URL）
字幕以 DOM overlay 燒入畫面（burned-in 繁體中文），另輸出 demo.srt；旁白為 Windows SAPI zh-HK 合成（narrated voice-over），自動朗讀時段刻意留白。

## 4. Verification 清單（全部本機實測）

| # | 項目 | 結果 | 實測依據 |
| --- | --- | --- | --- |
| 1 | Free text input（自由文字輸入→寫庫＋回答） | **PASS** | Playwright E2E `ui-smoke`＋`free-input` 41 cases（Vitest） |
| 2 | Voice input fallback（ASR 不支援時文字輸入常駐） | **PASS** | Vitest `asr.test.ts`（23）＋`tts.test.ts`（15）；UI 文字輸入路徑 E2E 覆蓋 |
| 3 | Dynamic vital/medication/symptom 記錄 | **PASS** | Vitest `assistantService`／`extraction`（36）／`free-input`（41）；E2E 血壓寫庫 |
| 4 | Dynamic chart／risk event | **PASS** | Vitest `healthRuleEngine`（25）；PDF/影片截圖實見圖表新點 |
| 5 | Elder → family alert | **PASS** | E2E `flagship`（血壓偏高→家屬提醒）；影片實錄 |
| 6 | Follow-up（已跟進→CaregiverFollowUp→Alert resolved） | **PASS** | Vitest `alertService`（9，含 Alert 去重）；E2E＋影片實錄 |
| 7 | Timeline（六表合併時間線） | **PASS** | E2E `flagship`／`routes` 覆蓋 /family/health |
| 8 | 7-day query（vitalsBetween 區間查詢） | **PASS** | Vitest `provider.test.ts`（10） |
| 9 | Policy search（知識庫政策搜尋） | **PASS** | Vitest `kb/search.test.ts`（17，31 篇文檔） |
| 10 | Safety flow（高風險攔截唔行 LLM） | **PASS** | Vitest `safetyScreen.test.ts`（15） |
| 11 | Persistence（reload 後數據仍在） | **PASS** | E2E `persistence.spec.ts` |
| 12 | Lint／Build | **PASS** | `tsc --noEmit` 零錯誤；`vite build` 成功（886 modules） |
| 13 | Vitest 單元測試 | **PASS** | 實測值見最終驗證報告（T1–T3 新增 login／i18n／localize／ElderHome autoplay 測試） |
| 14 | Playwright E2E | **PASS** | 實測值見最終驗證報告（新增 login／language／elder-tts spec） |
| 15 | PDF ≤ 5 頁 | **PASS** | pdf-lib 實測 `getPageCount() === 5`，A4（595×842pt） |
| 16 | GitHub Pages 線上可達 | **PASS** | <https://pbs-un.github.io/SilverCareVoice/> 已上線 |
| 17 | Supabase 雲端後端（Edge Function＋Postgres op-log/LWW＋Realtime） | **本地全量測試通過；雲端驗證待部署** | 代碼與遷移已就緒（`supabase/functions/silvercare`、`supabase/migrations/0001_sync_tables.sql`），本地全量測試（Vitest 285＋E2E 16）通過；線上驗證待完成 Supabase 部署與 GitHub vars 設定（步驟見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)） |

## 5. 用戶手動發布最少步驟

> 正式連結已上線：<https://pbs-un.github.io/SilverCareVoice/>（GitHub Actions CI 自動部署）。
> 以下步驟僅於需要從零重新發布時使用；所有遠端操作均保留給用戶本人執行（本交付嚴禁 push）：

```powershell
# 1. 設定遠端（首次）
git remote add origin <你的 GitHub 倉庫 URL>

# 2. 推送主分支（包含全部源碼與交付文檔）
git push origin master        # 或 main

# 3. 推送本地已建好的 gh-pages branch
git push origin gh-pages

# 4. GitHub 倉庫 Settings → Pages：
#    方案 A：Source 選 gh-pages branch
#    方案 B：Source 選 GitHub Actions（使用 repo 內 deploy-pages.yml）

# 5. 取得公開 URL 後，一條命令重生成含真實 URL + QR 的 PDF：
node scripts/generate-pdf.mjs --url <公開URL>
```

## 6. Limitations（已知限制）

- **雲端後端已實現，線上驗證待部署**：Supabase 雲端後端（Edge Function `silvercare`＋Postgres op-log/LWW＋Realtime 廣播）已完成實現並整合 CI；**本地全量測試通過**（Vitest 285 cases＋E2E 16 cases），雲端線上驗證待完成 Supabase 部署與 GitHub vars 設定（見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)）。本地 Node server（埠 8787）保留為本地開發／Mode B 與合約參照實現。
- **語音依賴瀏覽器**：ASR/TTS 使用 Web Speech API，Chromium 系支援最佳；不支援時自動隱藏麥克風、文字輸入常駐（fallback 已測試）。
- **Demo 規則非醫療標準**：內嵌 triage rules 僅供演示，不構成醫療建議或診斷。
- **DeepSeek 需自備 Key**：無 Key 時全程 Local Hybrid Engine（確定性離線模式）；E2E/產物生成腳本為可重現性一律強制本地模式。
- **影片為實時錄製**：無後製剪接，解析度 432×936（行動端視角）。

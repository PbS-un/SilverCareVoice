# DELIVERY.md — 銀髮一句通 SilverCare Macau 交付說明

交付任務：T11（PDF／影片／README／Pages 發布準備）。
本文件所有 Verification 結果均為本機實測（2026-08-05，Windows / Node 18+），未實測項一律標 PENDING。

---

## 1. 交付概覽

| 項目 | 狀態／值 |
| --- | --- |
| Functional Prototype URL | **待發布（PENDING）** —— 需由用戶 push 並啟用 GitHub Pages 後取得 |
| GitHub Pages | **待用戶 push**（`.github/workflows/deploy-pages.yml` 已備妥；本地 `gh-pages` branch 已建） |
| Release Branch | 本地 `gh-pages`（orphan branch）已建立，commit `a5c73e1`，內容為 `web/dist` 完整構建產物＋`.nojekyll`；**未 push** |
| Backend | Local Node Sync Server（埠 8787）：AI Proxy（DeepSeek）＋雙裝置同步（HTTP + WebSocket + SQLite）。同步端點使用配對 token（見 server/README.md） |
| AI | DeepSeek（經本地 proxy，Key 只存 `server/.env`）＋ **Local Hybrid Engine 離線 fallback**（無 Key／離線時全本地運行） |
| Database | IndexedDB（Dexie，前端本地優先）＋ SQLite（server 同步中繼）；備選 Supabase schema 見 `supabase/` |

## 2. 功能清單

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
| `deliverables/銀髮一句通_項目簡報.pdf` | **5 頁 A4**（pdf-lib 實測頁數 = 5，符合 ≤5 頁；595×842pt 標準 A4），內含 3 張實機 UI 截圖；URL/QR 為「待發布」佔位 |
| `deliverables/demo.webm` | Demo 影片，**實測時長約 65 秒**（目標 60–120 秒），2.4 MB，真實操作不剪接 |
| `README.md` | 完整繁體中文說明（兩種模式、快速開始、命令、架構、合規聲明） |
| `THIRD_PARTY.md` | 全部依賴清單（License 以 node_modules 實查核對） |
| `scripts/generate-pdf.mjs` | PDF 生成腳本（支持 `--url <URL>` 重生成含真實 QR 版本） |
| `scripts/generate-video.mjs` | 影片錄製腳本（Playwright recordVideo） |
| `scripts/deploy-pages.mjs` | 本地 gh-pages 部署腳本（git worktree，可重複執行，**明確不 push**） |
| `.github/workflows/deploy-pages.yml` | GitHub Pages workflow（push 後生效） |
| `web/src/pages/PrintBrief.tsx` | 簡報打印頁（路由 /print-brief） |

### PDF 頁面結構（5 頁）
1. **封面**：銀髮一句通／澳門長者 AI 慢病照護與家庭守護平台／核心句／三大賣點（澳門×極簡、慢病×家庭、數據×長期價值）
2. **雙端與資料流**：老人自由輸入→AI/Parser→Health Database→Risk Engine→Family Alert→Follow Up；實機截圖（/elder 回答氣泡＋/family/alerts）
3. **慢病閉環**：記錄→趨勢→異常→提示→家屬→跟進→紀錄；/family/health 血壓圖實機截圖（截圖前實際新增一筆 162/98，圖表可見新點）
4. **Database + AI Architecture**：Web Client→Safety Layer→Intent/Extraction→AI Provider(DeepSeek)+Knowledge Base→Repository→Database→Family/Insights；Consent/Audit/Privacy；標明 Demo triage rules 非醫療標準
5. **Try it yourself**：Prototype URL＋QR（「待發布」佔位）＋GitHub Pages 佔位＋5 條評委可自行輸入的示例句子

### Demo 影片內容（真實操作、不剪接）
Demo Reset → 同意頁 → /elder 輸入「我啱啱血壓158/95，仲有啲頭暈」→ 回答氣泡與今日狀態 → 快捷量血壓新增 162/98 → /family/health 圖表新點 → /family/alerts 新 Alert → 已跟進（上門＋備註）→ 回 /elder 見「家人已經知道 ✓」

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
| 13 | Vitest 單元測試 | **PASS** | 實測 **17 files / 285 tests 全綠**（2026-08-05 最終整合驗證實測值） |
| 14 | Playwright E2E | **PASS** | 實測 **16 passed**（30.5s） |
| 15 | PDF ≤ 5 頁 | **PASS** | pdf-lib 實測 `getPageCount() === 5`，A4（595×842pt） |
| 16 | GitHub Pages 線上可達 | **PENDING** | 需用戶 push 後才可驗證（見第 5 節） |

## 5. 用戶手動發布最少步驟

> 所有遠端操作均保留給用戶本人執行（本交付嚴禁 push）：

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

- **無真實雲端**：AI proxy 與 sync server 為本地 Node 進程（埠 8787），未部署任何雲端服務；Supabase schema 僅為備選藍圖。
- **語音依賴瀏覽器**：ASR/TTS 使用 Web Speech API，Chromium 系支援最佳；不支援時自動隱藏麥克風、文字輸入常駐（fallback 已測試）。
- **Demo 規則非醫療標準**：內嵌 triage rules 僅供演示，不構成醫療建議或診斷。
- **DeepSeek 需自備 Key**：無 Key 時全程 Local Hybrid Engine（確定性離線模式）；E2E/產物生成腳本為可重現性一律強制本地模式。
- **PDF 內 URL/QR 為佔位**：待發布；依第 5 節步驟 5 重生成即可。
- **影片為實時錄製**：無後製剪接，解析度 432×936（行動端視角）。

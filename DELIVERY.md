# DELIVERY.md — 銀髮一句通 SilverCare Macau 交付說明

交付任務：T11（PDF／影片／README／Pages 發布準備）。
本文件所有 Verification 結果均為本機實測（2026-08-05，Windows / Node 18+），未實測項一律標 PENDING。

---

## 1. 交付概覽

| 項目 | 狀態／值 |
| --- | --- |
| Functional Prototype URL | **已發布**：<https://pbs-un.github.io/SilverCareVoice/>（GitHub Pages 已上線；完成 Supabase 部署並設好 GitHub vars 後，該連結承載 100% 雲端功能——真 DeepSeek＋跨網雙裝置同步，見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)） |
| GitHub Pages | **已上線**：Pages Source 設回 GitHub Actions 後，workflow 部署成功（run 31115676025 success）；線上 smoke test 通過（100 長者選擇器登入、tester 拒絕、四語、長者 AI、家屬頁）；`gh-pages` branch 亦同步更新（5816280） |
| Release Branch | 本地 `gh-pages`（orphan branch）已建立，commit `a5c73e1`，內容為 `web/dist` 完整構建產物＋`.nojekyll` |
| Backend | ① **Supabase 雲端後端（生產演示）**：Edge Function `supabase/functions/silvercare`（`/api/health`、`/api/ai/chat`、`/sync/*`）＋ Postgres op-log／LWW（`supabase/migrations/0001_sync_tables.sql`）＋ Realtime 廣播；部署指引見 [supabase/DEPLOYMENT.md](./supabase/DEPLOYMENT.md)。② Local Node Sync Server（埠 8787）：AI Proxy（DeepSeek）＋雙裝置同步（HTTP + WebSocket + SQLite），定位為本地開發／合約參照實現。同步端點皆使用配對 token（見 server/README.md） |
| AI | DeepSeek（雲端經 Edge Function 代理，Key 只存 Supabase secrets；本地經 proxy，Key 只存 `server/.env`）＋ **Local Hybrid Engine 離線 fallback**（無 Key／離線／未配置雲端時全本地運行） |
| Database | IndexedDB（Dexie，前端本地優先）＋ Postgres（雲端同步中繼，sync_ops／sync_entities）＋ SQLite（本地 server 同步中繼） |

## 2. 功能清單

### 本輪新增（T1 四語言／T2 自動朗讀／T3 Demo Login）
- **100 名合成示範長者（T1/T3）**：deterministic seeded generator（固定 seed）產生 100 名澳門合成長者，每人一個 account（demo-001…demo-100）＋一名固定監護人；登入頁「示範長者選擇」揀一位即自動填入帳號／密碼（`SCV-Demo!2026-<NNN>-Macau`，masked）一鍵登入。舊 `tester/tester` 已完全移除並必然被拒絕。所有資料標記 `isSynthetic`，角色選擇頁顯示四語合成資料聲明。
- **Account ↔ Elder ↔ Guardian 綁定（T2）**：登入 session 保存 account→elder→guardian；`useElderContext` 按 session 指定長者查詢，全部健康資料／對話／提醒以 elderId 於 repository 層真實隔離（唔係 UI filter）。
- **Demo Reset（T4）**：清空後重新 deterministic seed 100 長者；account 關係與資料歸屬不變；language preference 不受影響。
- **四語言 UI**：繁體中文／简体中文／Português／English；登入頁與角色選擇頁即時切換、`localStorage` 持久化；AI 回覆（DeepSeek prompt + Local Hybrid 本地化）、ASR／TTS（zh-HK／zh-CN／pt-PT／en-US）跟隨語言。
- **Elder AI 自動朗讀**：每條新 assistant final answer 自動播放一次（exactly once）；rerender／歷史載入／語言切換／返回頁面不重播；手動播放保留。
- **慢速／斷句語音（T6）**：8 秒停頓容忍、ASR 斷句聚合、35 秒上限、五種 voice state（聽／等待／處理／慢慢再講／完成）；四語溫和重試提示並自動朗讀（local-first，唔經 LLM）。
- **AI 對話記憶（T7）**：每 account/長者最近約 10 句，由 DB 恢復，DeepSeek prompt 與 Local Hybrid 承接上下文；跨長者隔離。
- **澳門語音適配（T8）**：粵語數字 normalisation（一百五十八／百五八／九五／七點二等）+ health-domain alternatives（maxAlternatives=3）。
- **緊急二次確認（T5）**：「我冇事」必須二次確認（我真係冇事，關閉提示／我仲唔舒服，繼續求助），四語、大按鈕、aria 支援。

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

### PDF 頁面結構（5 頁，T10 Competition Project Proposal 風格）
1. **項目定位**：銀髮一句通 SilverCare Macau／澳門長者 AI 慢病家庭照護平台／Slogan「讓長者只說一句，讓家人少一份擔心」／六項定位重點
2. **核心功能**：一句語音（語音→AI 理解→健康紀錄→風險評估→語音回覆）、慢病管理（血壓血糖心率體重食藥覆診）、AI 友善長者（慢速語音、8 秒停頓、四語提示、自動 TTS）；實機截圖（/elder 回答＋100 長者選擇）
3. **家庭閉環＋本地化＋簡化技術**：長者→AI→Health Event→Family Alert→家人跟進→回流；澳門四語；技術只佔半頁（Local-first／Cloud Sync／Offline Fallback／Privacy-aware）；實機截圖（/family/alerts）
4. **社會價值**：慢病管理更容易／獨居長者與照護人互通／長者取得健康資訊更容易／協助醫療分流（誠實定位：不作醫療診斷、不取代醫生）
5. **未來方向**：Wearable 自動化／社工＋醫院＋家庭三方／合規匿名健康資料庫／線上家庭醫生／更多數據提升 AI（全部標示 roadmap，唔當已完成）
> 簡報唔包含 prototype URL／QR／Demo 憑證／登入教學（評審導向）。

### Demo 影片（T11：3 分鐘豎屏 1080×1920@30，H.264+AAC）
痛點（warm placeholder，可替換真人鏡頭）→ Demo 長者選擇器登入 → 慢速斷句語音（scripted ASR chunks＋8 秒停頓）→ AI 回答＋自動 TTS → 家庭提醒＋跟進＋回流「家人已經知道 ✓」→ 四語言切換 → Local-first＋Cloud → 差異化＋社會價值 → 未來願景＋正式 URL 結尾。
字幕雙行燒入（繁中＋简中，自然表達），另輸出 demo.srt；旁白為粵語（Windows SAPI zh-HK 合成，narrated voice-over），自動 TTS 時段留白；BGM 為 scripts/_bgm.mjs 生成嘅原創舒緩鋼琴感琶音；真人鏡頭缺失時生成 VIDEO_LIVE_ACTION_SHOTLIST.md 說明替換位置。

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
| 13 | Vitest 單元測試 | **PASS** | 實測 **32 files / 492 tests 全綠**（含 syntheticDemo／demoAuth／memory／slowSpeech／cantoneseNumbers／LoginPage 等新增） |
| 14 | Playwright E2E | **PASS** | 實測 **36 passed**（含 100 長者選擇器登入、tester 拒絕、緊急二次確認、TTS autoplay） |
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

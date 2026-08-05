import { defineConfig } from '@playwright/test'

/** 最小 node 環境型別（唔引入 @types/node，避免影響前端型別空間）。 */
declare const process: { env: Record<string, string | undefined> };

/** E2E 固定 sync 配對 token（server env 與客戶端 storageState 必須一致）。 */
const E2E_SYNC_TOKEN = 'e2e-sync-token'

/**
 * E2E 配置（T10）。
 *
 * webServer 起兩個進程：
 *  1. server（埠 8787）—— AI proxy + sync。
 *     E2E 強制 DEEPSEEK_API_KEY 為空（dotenv 唔會覆蓋已有環境變數），
 *     server 一律回 { provider:'local', reason:'no_key' }，
 *     客戶端確定性行 LocalHybridEngine —— 唔依賴真實 API Key。
 *     （「proxy 回 deepseek provider 客戶端採用」場景由 page.route mock /api/ai/chat 驗證。）
 *     SYNC_TOKEN 固定為 E2E_SYNC_TOKEN（/sync/* 與 WS 鑑權；Warning 5 修復）。
 *  2. vite dev server（埠 5173）—— 已配置 /api、/sync、/ws proxy 去 8787。
 *
 * globalSetup：server 就緒後在 server 端做一次 demo seed（tombstone 現存實體
 * ＋重蓋章 seed put），保證 sync 模式下每個 E2E 執行從乾淨示範資料出發
 * （App 只在 standalone 空庫自動 demoReset —— Warning 3 修復後的語義）。
 *
 * storageState：預載 localStorage scv.syncToken，令所有測試的 SyncClient /
 * Outbox 自動通過 token 鑑權，無需改動各 spec。
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './src/data/sync/scripts/e2e-global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // 每個測試 context 預載 sync token（等同裝置已完成配對）
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'scv.syncToken', value: E2E_SYNC_TOKEN }],
        },
      ],
    },
  },
  webServer: [
    {
      command: 'node ../server/index.mjs',
      url: 'http://localhost:8787/api/health',
      // 絕不復用既有進程：避免誤用帶真實 DEEPSEEK_API_KEY 嘅本地 dev server。
      // 8787 被佔用時 Playwright 會報錯，提示先停止該 dev server。
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        // 確定性：E2E 絕不調真實 DeepSeek
        DEEPSEEK_API_KEY: '',
        // E2E 固定 sync token（與 storageState / globalSetup 一致）
        SYNC_TOKEN: E2E_SYNC_TOKEN,
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        // 測試隔離：進程環境變數優先於 web/.env 文件（Vite env 載入順序），
        // 強制置空 → 前端必走本地模式（dev proxy → localhost:8787），
        // 杜絕開發者本地 .env 的真實 VITE_SUPABASE_URL 污染 E2E。
        VITE_SUPABASE_URL: '',
      },
    },
  ],
})

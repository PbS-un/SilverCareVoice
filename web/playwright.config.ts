import { defineConfig } from '@playwright/test'

/** 最小 node 環境型別（唔引入 @types/node，避免影響前端型別空間）。 */
declare const process: { env: Record<string, string | undefined> };

/**
 * E2E 配置（T10）。
 *
 * webServer 起兩個進程：
 *  1. server（埠 8787）—— AI proxy + sync。
 *     E2E 強制 DEEPSEEK_API_KEY 為空（dotenv 唔會覆蓋已有環境變數），
 *     server 一律回 { provider:'local', reason:'no_key' }，
 *     客戶端確定性行 LocalHybridEngine —— 唔依賴真實 API Key。
 *     （「proxy 回 deepseek provider 客戶端採用」場景由 page.route mock /api/ai/chat 驗證。）
 *  2. vite dev server（埠 5173）—— 已配置 /api、/sync、/ws proxy 去 8787。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../server/index.mjs',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // 確定性：E2E 絕不調真實 DeepSeek
        DEEPSEEK_API_KEY: '',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
})

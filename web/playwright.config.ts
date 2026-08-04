import { defineConfig } from '@playwright/test'

// E2E：後續任務補上實際用例。
// 本地先以 dev server 為目標；CI 可改為 preview + build。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

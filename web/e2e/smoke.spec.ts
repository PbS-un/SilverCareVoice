import { test, expect } from '@playwright/test'

// 佔位 E2E：確認骨架可啟動與渲染（後續任務替換為實際用例）
test('骨架載入畫面呈現品牌名稱', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('銀髮一句通')).toBeVisible()
})

/**
 * T10 E2E 場景 7：持久化 —— 輸入寫入 IndexedDB 後，page.reload() 仍可見。
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, askElder } from './helpers';

test('持久化：reload 後對話記錄與血壓記錄仍在', async ({ page }) => {
  test.setTimeout(120_000);
  await bypassConsent(page);

  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible({ timeout: 30_000 });
  await askElder(page, '我血壓 150/90');

  // reload 後對話歷史仍有該句（Conversation 持久化）
  await page.reload();
  await expect(page.getByTestId('conversation-history')).toContainText('我血壓 150/90', {
    timeout: 30_000,
  });

  // 我的記錄頁有該筆血壓（VitalRecord 持久化）
  await page.goto('/#/elder/health');
  const list = page.getByTestId('vital-list');
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list).toContainText('150/90 mmHg');
});

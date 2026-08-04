/**
 * T10 E2E 場景 6（完整閉環）：
 * Demo 重置 → 血壓＋症狀 → 家屬收到 Alert → 家屬跟進（電話＋備註）→
 * Alert 狀態更新為「已跟進」→ /family/health 時間線出現跟進紀錄 →
 * /elder 今日狀態顯示「家人已經知道 ✓」。
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, demoResetViaUI, askElder } from './helpers';

test('完整閉環：異常血壓 → 家屬提醒 → 跟進 → 時間線 → 長者端回饋', async ({ page }) => {
  test.setTimeout(180_000);
  await bypassConsent(page);

  // 1) Demo 重置
  await demoResetViaUI(page);

  // 2) 長者報告偏高血壓＋症狀
  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible();
  await askElder(page, '我血壓 165/88，有啲頭痛');

  // 3) 家屬端收到未處理提醒（列表按 createdAt 降冪 → 最新排最前）
  await page.goto('/#/family/alerts');
  const newest = page.getByTestId('family-alert-item').first();
  await expect(newest).toBeVisible({ timeout: 30_000 });
  await expect(newest).toContainText('未處理');

  // 4) 家屬跟進：電話 + 備註
  await newest.getByTestId('followup-button').click();
  await page.getByTestId('followup-type-phone').click();
  await page.getByTestId('followup-note').fill('已致電婆婆，叫佢坐低休息');
  await page.getByTestId('followup-submit').click();
  await expect(page.getByText('已記低跟進 ✓')).toBeVisible({ timeout: 15_000 });

  // 5) 該 Alert 狀態變「已跟進」
  await expect(page.getByTestId('family-alert-item').first()).toContainText('已跟進');

  // 6) /family/health 時間線出現跟進紀錄（照顧者名稱 + 備註）
  await page.goto('/#/family/health');
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await expect(timeline).toContainText('已跟進');
  await expect(timeline).toContainText('已致電婆婆，叫佢坐低休息');

  // 7) 長者端今日狀態顯示「家人已經知道 ✓」
  await page.goto('/#/elder');
  const status = page.getByTestId('today-status');
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status).toContainText('家人已經知道 ✓', { timeout: 15_000 });
});

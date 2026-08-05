/**
 * T10 E2E 場景 11：全部路由可直接到訪 + reload 不 404（HashRouter）。
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, login } from './helpers';

const ROUTES: Array<{ path: string; marker: string }> = [
  { path: '/', marker: 'role-elder' },
  { path: '/elder', marker: 'text-input' },
  { path: '/elder/health', marker: 'vital-list' },
  { path: '/family', marker: 'family-today-summary' },
  { path: '/family/health', marker: 'bp-chart' },
  { path: '/family/alerts', marker: 'family-alert-item' },
  { path: '/family/report', marker: 'weekly-report' },
  { path: '/insights', marker: 'insights-dashboard' },
  { path: '/report', marker: 'print-report' },
];

test('全部路由直接到訪 + reload 後仍正常呈現', async ({ page }) => {
  test.setTimeout(180_000);
  await bypassConsent(page);
  await login(page);

  for (const { path, marker } of ROUTES) {
    const hash = path === '/' ? '/' : `/#${path}`;
    await page.goto(hash);
    await expect(page.getByTestId(marker).first()).toBeVisible({ timeout: 30_000 });

    // reload（HashRouter 唔會 404）
    await page.reload();
    await expect(page.getByTestId(marker).first()).toBeVisible({ timeout: 30_000 });
  }
});

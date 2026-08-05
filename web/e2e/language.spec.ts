/**
 * T1 E2E：四語言切換 + refresh 保留。
 */
import { test, expect } from '@playwright/test';

import { login } from './helpers';

test('四語言切換即時生效，refresh 保留', async ({ page }) => {
  await login(page);

  // 繁體中文（預設）
  await expect(page.getByText('我是長者')).toBeVisible();

  // 简体中文
  await page.getByTestId('lang-zh-CN').click();
  await expect(page.getByText('我是长者')).toBeVisible();

  // Português
  await page.getByTestId('lang-pt').click();
  await expect(page.getByText('Sou idoso(a)')).toBeVisible();

  // English
  await page.getByTestId('lang-en').click();
  await expect(page.getByText('I am a senior')).toBeVisible();
  await expect(page.getByText('Demo Reset')).toBeVisible();

  // refresh 保留 English
  await page.reload();
  await expect(page.getByText('I am a senior')).toBeVisible({ timeout: 30_000 });
});

test('登入頁亦可切換語言', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('language-selector').selectOption('en');
  await expect(page.getByText('Log in')).toBeVisible();
});

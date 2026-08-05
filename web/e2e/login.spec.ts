/**
 * T3 E2E：Demo Login 流程 + 路由保護 + session 保持。
 *  - 未登入打開 app → Login
 *  - tester / tester → 成功 → Role Selection
 *  - wrong password → 失敗
 *  - 未登入直接訪問 /#/elder → Login
 *  - refresh session → 保持登入
 */
import { test, expect } from '@playwright/test';

test('未登入打開 app 先見 Demo Login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-login-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('demo-login-id')).toBeVisible();
  await expect(page.getByTestId('demo-login-password')).toBeVisible();
});

test('tester / tester 登入成功 → 角色選擇', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-login-id').fill('tester');
  await page.getByTestId('demo-login-password').fill('tester');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('role-family')).toBeVisible();
  await expect(page.getByTestId('role-insights')).toBeVisible();
});

test('wrong password 失敗並顯示錯誤', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-login-id').fill('tester');
  await page.getByTestId('demo-login-password').fill('wrong-password');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('demo-login-error')).toBeVisible({ timeout: 10_000 });
  // 仍在登入頁，未進入角色選擇
  await expect(page.getByTestId('role-elder')).toHaveCount(0);
});

test('未登入直接訪問 /#/elder → 導向 Login', async ({ page }) => {
  await page.goto('/#/elder');
  await expect(page.getByTestId('demo-login-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('text-input')).toHaveCount(0);
});

test('refresh 後 session 保持登入', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-login-id').fill('tester');
  await page.getByTestId('demo-login-password').fill('tester');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
});

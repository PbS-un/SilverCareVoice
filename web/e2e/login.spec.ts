/**
 * T3 E2E：Demo Login（100 示範長者選擇器）流程 + 路由保護 + session 保持。
 *  - 未登入打開 app → Login
 *  - 揀示範長者 → 帳號密碼自動填入 → 成功 → Role Selection
 *  - tester / tester → 失敗
 *  - wrong password → 失敗
 *  - 未登入直接訪問 /#/elder → Login
 *  - refresh session → 保持登入
 */
import { test, expect } from '@playwright/test';

test('未登入打開 app 先見 Demo Login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-login-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('demo-elder-select')).toBeVisible();
  await expect(page.getByText('Demo 模式：帳號及健康資料均為系統生成，只供功能展示。')).toBeVisible();
});

test('示範長者選擇器列出 100 人；揀陳婆婆 → 自動填入 → 登入成功', async ({ page }) => {
  await page.goto('/');
  const select = page.getByTestId('demo-elder-select');
  await expect(select.locator('option[value="seed-elder-01"]')).toHaveCount(1, { timeout: 30_000 });
  const optionCount = await select.locator('option').count();
  expect(optionCount).toBeGreaterThanOrEqual(101); // 100 長者 + placeholder
  await select.selectOption('seed-elder-01');
  await expect(page.getByTestId('demo-login-id')).toHaveValue('demo-001');
  await expect(page.getByTestId('demo-login-password')).toHaveValue('SCV-Demo!2026-001-Macau');
  await expect(page.getByTestId('demo-login-password')).toHaveAttribute('type', 'password');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('role-family')).toBeVisible();
  await expect(page.getByTestId('role-insights')).toBeVisible();
});

test('tester / tester 被拒絕', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-elder-select').waitFor({ timeout: 30_000 });
  await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
  await page.getByTestId('demo-login-id').fill('tester');
  await page.getByTestId('demo-login-password').fill('tester');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('demo-login-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('role-elder')).toHaveCount(0);
});

test('wrong password 失敗並顯示錯誤', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-elder-select').waitFor({ timeout: 30_000 });
  await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
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
  await page.getByTestId('demo-elder-select').waitFor({ timeout: 30_000 });
  await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
});

test('從受保護路由登入後一定先進角色選擇（唔直接入 /elder）', async ({ page }) => {
  await page.goto('/#/elder');
  await expect(page.getByTestId('demo-login-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('demo-elder-select').waitFor({ timeout: 30_000 });
  await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('text-input')).toHaveCount(0);
});

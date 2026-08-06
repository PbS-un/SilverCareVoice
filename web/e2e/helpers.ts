/**
 * T10 E2E 共用工具：
 * - login：經真實 UI 完成 Demo Login（選示範長者 demo-001 陳婆婆）→ 角色選擇
 * - bypassConsent：用 localStorage 標記略過同意畫面（等同用戶已同意）
 * - demoResetViaUI：經真實 UI 執行 Demo 重置
 * - askElder：文字輸入 → 發送 → 等待回答氣泡
 */
import { expect, type Page } from '@playwright/test';

/** 經真實 UI 執行 Demo Login：選 demo-001（陳婆婆）→ 一鍵登入 → 角色選擇頁。 */
export async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('demo-elder-select').waitFor({ state: 'visible', timeout: 30_000 });
  // 100 名長者：確保選項已載入
  await expect(page.getByTestId('demo-elder-select').locator('option[value="seed-elder-01"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
  await page.getByTestId('demo-login-submit').click();
  await expect(page.getByTestId('role-elder')).toBeVisible({ timeout: 30_000 });
}

/** 略過 ConsentScreen（localStorage 標記，與產品邏輯一致）。 */
export async function bypassConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('scv.consent.v1', '1');
  });
}

/** 經角色選擇頁真實 UI 執行 Demo 重置。 */
export async function demoResetViaUI(page: Page): Promise<void> {
  await login(page);
  await page.goto('/');
  await page.getByTestId('demo-reset').click();
  await page.getByTestId('demo-reset-confirm').click();
  await expect(page.getByText('已重置為示範資料 ✓')).toBeVisible({ timeout: 30_000 });
}

/** 喺老人端文字輸入並發送，回傳回答氣泡 locator。 */
export async function askElder(page: Page, text: string) {
  await page.getByTestId('text-input').fill(text);
  await page.getByTestId('send-button').click();
  const bubble = page.getByTestId('answer-bubble');
  await expect(bubble).toBeVisible({ timeout: 30_000 });
  return bubble;
}

/** 讀取週報「N/M 次已服」嘅已服次數。 */
export async function readAdherenceTaken(page: Page): Promise<number> {
  await page.goto('/#/family/report');
  const report = page.getByTestId('weekly-report');
  await expect(report).toBeVisible({ timeout: 30_000 });
  const text = await report.innerText();
  const m = text.match(/(\d+)\/(\d+)\s*次已服/);
  expect(m, `週報應有「N/M 次已服」，實際：${text}`).not.toBeNull();
  return Number(m![1]);
}

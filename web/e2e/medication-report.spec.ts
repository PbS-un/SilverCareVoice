/**
 * T10 E2E 場景 2：服藥記錄 → 家屬端服藥狀態 + 週報依從率變化。
 *
 * 流程：先記「漏服」再記「已服」（驗證狀態可翻转），再用自由輸入
 * 「我食咗薄血藥」新增一筆新藥已服記錄（任何時段都會落入 7 日窗口），
 * 令週報「N/M 次已服」嘅已服次數確定 +1 —— 全部 DB 實算，無固定數字。
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, askElder, readAdherenceTaken } from './helpers';

test('服藥記錄：老人端操作 → 家屬端狀態 + 週報依從率變化', async ({ page }) => {
  test.setTimeout(120_000);
  await bypassConsent(page);

  // 0) 初始週報已服次數（DB 實算）
  const takenBefore = await readAdherenceTaken(page);

  // 1) 老人端快捷「記錄食藥」→ 先記漏服（藥物搜尋 combobox）
  await page.goto('/#/elder');
  await page.getByTestId('quick-med').click();
  await page.getByTestId('med-search-input').fill('降壓藥');
  await page.getByTestId('med-search-option-0').click();
  await page.getByTestId('med-missed').click();
  await expect(page.getByRole('status').filter({ hasText: '已記低：漏服 ✓' })).toBeVisible({
    timeout: 15_000,
  });

  // 家屬端今日服藥顯示「漏服」
  await page.goto('/#/family');
  const summary = page.getByTestId('family-today-summary');
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.getByText('漏服').first()).toBeVisible();

  // 2) 再記已服 → 狀態翻轉
  await page.goto('/#/elder');
  await page.getByTestId('quick-med').click();
  await page.getByTestId('med-search-input').fill('降壓藥');
  await page.getByTestId('med-search-option-0').click();
  await page.getByTestId('med-taken').click();
  await expect(page.getByRole('status').filter({ hasText: '已記低：已服 ✓' })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/#/family');
  await expect(page.getByTestId('family-today-summary')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('family-today-summary').getByText('已服').first()).toBeVisible();

  // 3) 自由輸入新藥已服（新 MedicationLog scheduledAt=now，必入 7 日窗口）。
  // T16 門控：冇匹配唔再靜默建藥 → 提議新增；覆詞確認後先 createMedication＋記 log。
  await page.goto('/#/elder');
  const medBubble = await askElder(page, '我食咗薄血藥');
  await expect(medBubble).toContainText('要唔要');
  await askElder(page, '好呀');

  // 家屬端出現「薄血藥 · 已服」
  await page.goto('/#/family');
  const famSummary = page.getByTestId('family-today-summary');
  await expect(famSummary).toBeVisible({ timeout: 30_000 });
  await expect(famSummary.getByText('薄血藥')).toBeVisible({ timeout: 15_000 });

  // 4) 週報已服次數 = 初始 + 1（漏服→已服淨變化為 0，新藥 +1）
  const takenAfter = await readAdherenceTaken(page);
  expect(takenAfter).toBe(takenBefore + 1);
});

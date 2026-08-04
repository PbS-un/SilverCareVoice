/**
 * T10 E2E 場景 1（旗艦全鏈路）：
 * Demo 重置 → 長者文字輸入「血壓 158/95 + 頭暈」→ 回答氣泡 →
 * /family/health 圖表與時間線出現新點 → /family/alerts 出現未處理提醒 →
 * /elder 今日狀態顯示「有 N 件事要留意」。
 *
 * Server 以 DEEPSEEK_API_KEY='' 啟動 → provider:'local' → 本地引擎（確定性）。
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, demoResetViaUI, askElder } from './helpers';

test('旗艦：高血壓＋症狀 → 回答／圖表／家屬提醒／今日狀態 全鏈路', async ({ page }) => {
  test.setTimeout(120_000);
  await bypassConsent(page);

  // 1) Demo 重置（真實 UI 流程）
  await demoResetViaUI(page);

  // 2) 長者端文字輸入
  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible();
  const bubble = await askElder(page, '我血壓 158/95，仲有啲頭暈');

  // 回答氣泡：非空 + 免責聲明 + 離線模式 provider 標記
  const answerText = (await bubble.innerText()).trim();
  expect(answerText.length).toBeGreaterThan(0);
  await expect(bubble).toContainText('以上為健康資訊，唔係醫療診斷。');
  await expect(bubble).toContainText('離線模式');

  // 3) 家屬健康趨勢：血壓圖出現 + 時間線有新記錄「158/95」
  await page.goto('/#/family/health');
  await expect(page.getByTestId('bp-chart')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('timeline')).toContainText('158/95 mmHg', { timeout: 15_000 });

  // 4) 家屬提醒：出現至少一個「未處理」新提醒（seed alert 係 已跟進）
  await page.goto('/#/family/alerts');
  const items = page.getByTestId('family-alert-item');
  await expect(items.first()).toBeVisible({ timeout: 30_000 });
  await expect(items.filter({ hasText: '未處理' }).first()).toBeVisible();

  // 5) 長者端今日狀態：由「大致正常」轉為「有 N 件事要留意」
  await page.goto('/#/elder');
  const status = page.getByTestId('today-status');
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(status.getByText(/有 \d+ 件事要留意/)).toBeVisible({ timeout: 15_000 });
});

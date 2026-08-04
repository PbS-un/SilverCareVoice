import { test, expect, type Page } from '@playwright/test';

/**
 * T6 UI 冒煙測試：
 *  1. 角色選擇頁載入
 *  2. /elder 文字問答 → 回答氣泡 + SymptomRecord 真寫入 IndexedDB
 *  3. /family/alerts 可見 seed alert
 *
 * 首次進入老人／家屬端會彈出同意畫面 —— 先按「我同意」。
 */

async function agreeConsentIfShown(page: Page): Promise<void> {
  const btn = page.getByTestId('consent-agree');
  // 同意可能已被先前測試寫入（localStorage 持久），只在出現時點擊
  await btn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  }
}

async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('silvercare-db');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(name)) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction(name, 'readonly');
          const rq = tx.objectStore(name).count();
          rq.onsuccess = () => {
            db.close();
            resolve(rq.result);
          };
          rq.onerror = () => reject(rq.error);
        };
        req.onerror = () => reject(req.error);
      }),
    store,
  );
}

test('角色選擇頁載入三個入口', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('role-elder')).toBeVisible();
  await expect(page.getByTestId('role-family')).toBeVisible();
  await expect(page.getByTestId('role-insights')).toBeVisible();
  await expect(page.getByTestId('demo-reset')).toBeVisible();
});

test('長者頁輸入「我今日有啲頭暈」出現回答氣泡且 SymptomRecord 寫入 DB', async ({ page }) => {
  await page.goto('/#/elder');
  await agreeConsentIfShown(page);

  const before = await countStore(page, 'symptomRecords');

  await page.getByTestId('text-input').fill('我今日有啲頭暈');
  await page.getByTestId('send-button').click();

  await expect(page.getByTestId('answer-bubble')).toBeVisible({ timeout: 30_000 });

  // 等 DB 寫入 settle（ask 內先寫 SymptomRecord 再回傳，理論上已寫入）
  await expect
    .poll(() => countStore(page, 'symptomRecords'), { timeout: 10_000 })
    .toBeGreaterThan(before);
});

test('家屬提醒頁可見 seed alert', async ({ page }) => {
  await page.goto('/#/family/alerts');
  await agreeConsentIfShown(page);
  await expect(page.getByTestId('family-alert-item').first()).toBeVisible({ timeout: 15_000 });
});

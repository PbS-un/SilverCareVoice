/**
 * T10 E2E：老人端助手場景
 *  - 場景 3：「最近七日血壓點樣」→ 動態計算平均值（測試端按 seed 同口徑實算比對）
 *  - 場景 4：胸痛 → 緊急紅色全屏 + 通知家人 + 緊急求助 999 + 家屬端 urgent 提醒
 *  - 場景 5：全新生活句子 → 合理回應，絕無「只支援預設問題」
 *  - 場景 8：≥10 條 data-driven 自由輸入全部有非空回答且寫入對話
 *  - 場景 9：政策／醫療資源查詢 → 回答附「資料來源」
 *  - 場景 10：無 Web Speech API → 麥克風隱藏、文字輸入照常、不崩潰
 *  - DeepSeek stub：page.route 模擬 /api/health + /api/ai/chat → 客戶端採用 deepseek provider
 */
import { test, expect, type Page } from '@playwright/test';

import { bypassConsent, askElder } from './helpers';

/** 與 seed.ts 相同口徑：N 日前本地時間 08:10。 */
function seedTime(daysAgo: number): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(8, 10, 0, 0);
  return d.getTime();
}

test.beforeEach(async ({ page }) => {
  await bypassConsent(page);
});

async function gotoElder(page: Page): Promise<void> {
  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible({ timeout: 30_000 });
}

test('場景3：最近七日血壓平均由 DB 動態計算', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  // 按 seed BP_SERIES 與當前時間實算預期平均（今日 08:10 一筆在早上測試時屬未來，不入窗口）
  const series = [
    { sys: 132, dia: 84, daysAgo: 5 },
    { sys: 145, dia: 90, daysAgo: 4 },
    { sys: 138, dia: 86, daysAgo: 3 },
    { sys: 150, dia: 93, daysAgo: 2 },
    { sys: 142, dia: 88, daysAgo: 1 },
    { sys: 147, dia: 91, daysAgo: 0 },
  ];
  const now = Date.now();
  const from = now - 7 * 86_400_000;
  const inWindow = series.filter((r) => {
    const t = seedTime(r.daysAgo);
    return t >= from && t <= now;
  });
  expect(inWindow.length).toBeGreaterThan(0);
  const expSys = Math.round(inWindow.reduce((s, r) => s + r.sys, 0) / inWindow.length);
  const expDia = Math.round(inWindow.reduce((s, r) => s + r.dia, 0) / inWindow.length);

  const bubble = await askElder(page, '最近七日血壓點樣？');
  await expect(bubble).toContainText(`最近七日你平均血壓約 ${expSys}/${expDia} mmHg`);
  await expect(bubble).toContainText(/大致平穩|有上升趨勢|有下降趨勢/);
});

test('場景4：胸痛 → 緊急模式 + 通知家人 + 999 + 家屬 urgent 提醒', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  await page.getByTestId('text-input').fill('我胸口突然好痛');
  await page.getByTestId('send-button').click();

  // 紅色全屏緊急提醒
  const overlay = page.getByTestId('emergency-overlay');
  await expect(overlay).toBeVisible({ timeout: 30_000 });

  // 安全路徑已自動建立 Alert → 通知按鈕直接顯示「家人已收到通知 ✓」
  await expect(overlay.getByTestId('notify-family')).toHaveText('家人已收到通知 ✓');

  // 緊急求助 → 999（撥號畫面）→ 返回 → 關閉
  await overlay.getByTestId('emergency-call').click();
  await expect(overlay.getByTestId('emergency-999')).toBeVisible();
  await overlay.getByText('返回', { exact: true }).click();
  await overlay.getByText('我冇事，關閉').click();
  await expect(overlay).toBeHidden();

  // 家屬端出現 urgent（緊急）提醒
  await page.goto('/#/family/alerts');
  const urgentItem = page
    .getByTestId('family-alert-item')
    .filter({ hasText: '緊急' })
    .filter({ hasText: '陳婆婆有緊急情況' })
    .first();
  await expect(urgentItem).toBeVisible({ timeout: 30_000 });
  await expect(urgentItem).toContainText('未處理');
});

test('場景5：全新生活句子有合理回應，無「只支援預設問題」', async ({ page }) => {
  await gotoElder(page);
  const bubble = await askElder(page, '今朝同鄰居去咗公園散步，晒咗陣太陽，心情好好');
  const text = (await bubble.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toContain('只支援預設問題');
});

test('場景8：≥10 條自由輸入全部有非空回答且寫入對話記錄', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoElder(page);

  const inputs = [
    '我今日有啲頭暈',
    '我血壓 128/82',
    '我血糖 6.2',
    '我食咗降壓藥',
    '下星期三要覆診',
    '醫療券點樣用？',
    '附近有咩醫院可以睇醫生？',
    '我個女今日會嚟探我',
    '今晚瞓得唔好，有啲攰',
    '我體重 110 磅',
    '今日冇乜胃口食飯',
  ];

  for (const input of inputs) {
    const bubble = await askElder(page, input);
    const text = (await bubble.innerText()).trim();
    expect(text.length, `「${input}」應有非空回答`).toBeGreaterThan(0);
    // 對話記錄（DB）必須出現該句輸入 —— 驗證真實持久化
    await expect(page.getByTestId('conversation-history')).toContainText(input);
    // 絕無錯誤提示
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('場景9：政策／醫療資源查詢附資料來源', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  const policyBubble = await askElder(page, '長者津貼點樣申請？');
  await expect(policyBubble).toContainText('資料來源：');

  const serviceBubble = await askElder(page, '附近有咩醫院可以睇醫生？');
  await expect(serviceBubble).toContainText('資料來源：');
});

test('場景10：無 Web Speech API 時麥克風隱藏、文字輸入照常', async ({ page }) => {
  // 確保語音 API 不存在（Chromium headless 本來就冇，雙重保險）
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await gotoElder(page);

  await expect(page.getByTestId('mic-button')).toHaveCount(0);
  const bubble = await askElder(page, '我今日有啲頭暈');
  expect((await bubble.innerText()).trim().length).toBeGreaterThan(0);
});

test('DeepSeek stub：mock proxy 回應 → 客戶端採用 DeepSeek provider', async ({ page }) => {
  test.setTimeout(120_000);

  let chatCalled = false;
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  await page.route('**/api/ai/chat', (route) => {
    chatCalled = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'deepseek',
        analysis: {
          intent: 'symptom',
          riskLevel: 'normal',
          answer: '【DeepSeek 測試回覆】收到你嘅情況，記低咗，注意休息。',
          detailedAnswer: '呢段係測試用嘅詳細說明。',
        },
      }),
    });
  });

  await gotoElder(page);
  const bubble = await askElder(page, '我今日有啲頭暈');

  expect(chatCalled).toBe(true);
  await expect(bubble).toContainText('【DeepSeek 測試回覆】');
  await expect(bubble).toContainText('DeepSeek');
});

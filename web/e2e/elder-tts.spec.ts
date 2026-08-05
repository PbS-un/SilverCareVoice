/**
 * T2 E2E：Elder AI answer 自動朗讀 exactly once（stub speechSynthesis 計數）。
 *  - 新 answer → 自動播放一次
 *  - reload 後歷史載入 → 不自動播放
 *  - 第二個新 answer → 再播一次
 *  - manual speaker 保留
 */
import { test, expect } from '@playwright/test';

import { bypassConsent, login, askElder } from './helpers';

/** 注入可計數嘅 speechSynthesis stub（不依賴真實 browser voice）。 */
async function stubTts(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __ttsCalls: number;
      speechSynthesis: unknown;
    };
    w.__ttsCalls = 0;
    const count = (utterance: SpeechSynthesisUtterance): void => {
      w.__ttsCalls += 1;
      setTimeout(() => utterance.onend?.({} as never), 30);
    };
    // 優先包住原生 speechSynthesis（headless Chromium 已有實例；直接覆寫
    // window.speechSynthesis 喺某些版本會因 non-configurable accessor 失敗）
    try {
      const real = w.speechSynthesis as
        | (SpeechSynthesis & { speak: (u: SpeechSynthesisUtterance) => void })
        | undefined;
      if (real && typeof real.speak === 'function') {
        real.speak = (u: SpeechSynthesisUtterance) => count(u);
        real.cancel = () => undefined;
        real.getVoices = () => [];
        return;
      }
    } catch {
      /* fall through */
    }
    // fallback：自建 stub
    const synth = {
      speak: (utterance: SpeechSynthesisUtterance) => count(utterance),
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      getVoices: () => [],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    try {
      Object.defineProperty(w, 'speechSynthesis', { value: synth, configurable: true });
    } catch {
      /* 極端環境：唔影響 application 自身 */
    }
  });
}

async function ttsCalls(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __ttsCalls: number }).__ttsCalls);
}

test.beforeEach(async ({ page }) => {
  await bypassConsent(page);
  await stubTts(page);
  await login(page);
});

test('新 answer 自動播放一次；reload 歷史不重播；第二個新 answer 再播一次', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible({ timeout: 30_000 });

  // 歷史載入不自動播放
  expect(await ttsCalls(page)).toBe(0);

  // 第一條新 answer → 自動播放一次
  await askElder(page, '我今日有啲頭暈');
  await expect.poll(() => ttsCalls(page), { timeout: 10_000 }).toBe(1);

  // reload：歷史載入，不重播
  await page.reload();
  await expect(page.getByTestId('text-input')).toBeVisible({ timeout: 30_000 });
  // addInitScript 每次 navigation 重設計數器；reload 後歷史載入若重播會 ≥1，
  // 因此 0 即證明「歷史不自動播放」
  expect(await ttsCalls(page)).toBe(0);

  // 第二條新 answer → 再播一次（計數器重設後 = 1）
  await askElder(page, '我血壓 128/82');
  await expect.poll(() => ttsCalls(page), { timeout: 10_000 }).toBe(1);

  // manual speaker 保留：點「🔊 播放」再讀一次
  await page.getByTestId('speak-button').click();
  await expect.poll(() => ttsCalls(page), { timeout: 10_000 }).toBe(2);
});

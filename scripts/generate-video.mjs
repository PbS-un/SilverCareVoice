/**
 * scripts/generate-video.mjs（T11 交付物）
 *
 * 用 Playwright(chromium) 的 context recordVideo 錄製 deliverables/demo.webm。
 * 內容為「真實操作、不剪接」的完整閉環：
 *   Demo Reset → 同意頁 → /elder 輸入「我啱啱血壓158/95，仲有啲頭暈」
 *   → 回答氣泡與今日狀態 → /family/health 圖表新點 → /family/alerts 新提醒
 *   → 已跟進 → 回 /elder 見「家人已經知道 ✓」
 *
 * 確定性：後端以空 DEEPSEEK_API_KEY 啟動（provider:local），
 * 全程不依賴真實 API Key；每步停留足夠觀看，總長約 60–120 秒。
 *
 * 用法：node scripts/generate-video.mjs [--build]
 */
import { mkdirSync, renameSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT, ensureBuild, startServer, startPreview, sleep } from './_lib.mjs';

const BASE = 'http://localhost:4173';
const DELIVERABLES = path.join(ROOT, 'deliverables');
const VIDEO_TMP = path.join(DELIVERABLES, '.video-tmp');
const OUT_VIDEO = path.join(DELIVERABLES, 'demo.webm');

async function agreeConsentIfShown(page) {
  const btn = page.getByTestId('consent-agree');
  await btn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await btn.isVisible().catch(() => false)) {
    await sleep(900); // 讓觀眾看清同意頁
    await btn.click();
  }
}

async function main() {
  const forceBuild = process.argv.includes('--build');
  mkdirSync(DELIVERABLES, { recursive: true });
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });

  await ensureBuild(forceBuild);
  const serverProc = await startServer();
  const previewProc = await startPreview();

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      recordVideo: { dir: VIDEO_TMP, size: { width: 432, height: 936 } },
    });
    const page = await ctx.newPage();
    const recStart = Date.now(); // 錄製長度以 context 建立後起算

    /* 1) 開場：角色選擇頁 */
    await page.goto(`${BASE}/`);
    await page.getByTestId('role-elder').waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(3_000);

    /* 2) Demo Reset */
    await page.getByTestId('demo-reset').click();
    await sleep(1_200);
    await page.getByTestId('demo-reset-confirm').click();
    await page.getByText('已重置為示範資料').waitFor({ timeout: 30_000 });
    await sleep(2_500);

    /* 3) 進入長者端 → 同意頁 */
    await page.getByTestId('role-elder').click();
    await agreeConsentIfShown(page);
    await sleep(1_500);

    /* 4) 一句輸入 → 回答 */
    await page.getByTestId('text-input').click();
    await page.getByTestId('text-input').pressSequentially('我啱啱血壓158/95，仲有啲頭暈', { delay: 110 });
    await sleep(900);
    await page.getByTestId('send-button').click();
    await page.getByTestId('answer-bubble').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('answer-bubble').scrollIntoViewIfNeeded();
    await sleep(5_000); // 讓觀眾閱讀回答

    /* 5) 今日狀態 */
    await page.getByTestId('today-status').scrollIntoViewIfNeeded();
    await sleep(3_000);

    /* 6) 快捷「量血壓」→ 實際新增一筆（圖表新點的來源） */
    await page.getByTestId('quick-bp').click();
    await sleep(1_000);
    await page.getByTestId('bp-systolic-input').fill('162');
    await page.getByTestId('bp-diastolic-input').fill('98');
    await sleep(800);
    await page.getByTestId('bp-submit').click();
    await page.getByText('已經通知家人').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await sleep(3_000);

    /* 7) 家屬端：健康趨勢（圖表出現新點） */
    await page.goto(`${BASE}/#/family/health`);
    await agreeConsentIfShown(page);
    await page
      .locator('section', { has: page.getByTestId('bp-chart') })
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('section', { has: page.getByTestId('bp-chart') }).scrollIntoViewIfNeeded();
    await sleep(5_000);

    /* 8) 家屬端：提醒列表（新 Alert） */
    await page.goto(`${BASE}/#/family/alerts`);
    await page.getByTestId('family-alert-item').first().waitFor({ state: 'visible', timeout: 15_000 });
    await sleep(3_500);

    /* 9) 已跟進 */
    await page.getByTestId('followup-button').first().click();
    await sleep(1_200);
    await page.getByTestId('followup-type-visit').click();
    await sleep(700);
    await page.getByTestId('followup-note').fill('已致電長者，安排明日陪佢去衛生中心覆診。');
    await sleep(1_200);
    await page.getByTestId('followup-submit').click();
    await page.getByText('已記低跟進').waitFor({ timeout: 15_000 });
    await sleep(3_000);

    /* 10) 回長者端：家人已經知道 ✓ */
    await page.goto(`${BASE}/#/elder`);
    await page.getByTestId('today-status').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('today-status').scrollIntoViewIfNeeded();
    await page.getByText('家人已經知道').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await sleep(4_000);

    /* 收尾：先取影片句柄，再關閉 context 使影片落盤 */
    const video = page.video();
    await page.close();
    await ctx.close();
    const ctxClosedAt = Date.now();
    await browser.close();

    if (!video) throw new Error('未取得錄影片段');
    const src = await video.path();
    if (existsSync(OUT_VIDEO)) rmSync(OUT_VIDEO);
    renameSync(src, OUT_VIDEO);
    rmSync(VIDEO_TMP, { recursive: true, force: true });

    const seconds = Math.round((ctxClosedAt - recStart) / 1000);
    const sizeMb = (statSync(OUT_VIDEO).size / 1048576).toFixed(1);
    console.log(`[video] 已生成：${OUT_VIDEO}`);
    console.log(`[video] 影片時長約 ${seconds} 秒（目標 60–120 秒），檔案 ${sizeMb} MB`);
  } finally {
    serverProc.kill();
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error('[video] 失敗：', err);
  process.exit(1);
});

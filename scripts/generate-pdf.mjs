/**
 * scripts/generate-pdf.mjs（T11 交付物）
 *
 * 用 Playwright(chromium) 把 /print-brief（A4 × 5 頁）打印成
 * deliverables/銀髮一句通_項目簡報.pdf。
 *
 * 流程（全部真實操作，非預設素材）：
 *  1. build web（可 --skip-build 略過）
 *  2. 起 server(8787, provider:local) + vite preview(4173)
 *  3. Playwright 實機操作：Demo Login（tester/tester）→ Demo Reset → /elder 輸入句子 → 回答氣泡
 *     → 快捷「量血壓」新增一筆 → /family/health 圖表（多出新點）
 *     → /family/alerts 提醒列表；三頁截圖複製進 dist/brief/
 *  4. 有 --url 時用 qrcode 生成 QR data URL 注入 /print-brief
 *  5. page.pdf() 輸出 A4，用 pdf-lib 校驗頁數 ≤ 5
 *
 * 用法：
 *   node scripts/generate-pdf.mjs                 # URL/QR 用「待發布」佔位
 *   node scripts/generate-pdf.mjs --url <公開URL> # 發布後重生成（真實 URL + QR）
 *   node scripts/generate-pdf.mjs --build         # 強制重新 build
 */
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { ROOT, WEB_DIR, ensureBuild, startServer, startPreview, sleep } from './_lib.mjs';

const BASE = 'http://localhost:4173';
const DELIVERABLES = path.join(ROOT, 'deliverables');
const OUT_PDF = path.join(DELIVERABLES, '銀髮一句通_項目簡報.pdf');

function parseArgs(argv) {
  const args = { url: '', build: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[i + 1] ?? '';
    if (argv[i] === '--build') args.build = true;
    if (argv[i] === '--skip-build') args.build = false;
  }
  return args;
}

async function agreeConsentIfShown(page) {
  const btn = page.getByTestId('consent-agree');
  await btn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

/** 真實操作取三張 UI 截圖，寫入 web/dist/brief/ */
async function captureScreenshots() {
  const briefDir = path.join(WEB_DIR, 'dist', 'brief');
  mkdirSync(briefDir, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  // 1) Demo Login（T3：一律經真實登入流程，不 bypass）
  await page.goto(`${BASE}/`);
  await page.getByTestId('demo-login-id').fill('tester');
  await page.getByTestId('demo-login-password').fill('tester');
  await page.getByTestId('demo-login-submit').click();
  await page.getByTestId('role-elder').waitFor({ timeout: 30_000 });

  // 2) Demo Reset（保證可重複執行、狀態確定）
  await page.getByTestId('demo-reset').click();
  await page.getByTestId('demo-reset-confirm').click();
  await page.getByText('已重置為示範資料').waitFor({ timeout: 30_000 });
  await sleep(800);

  // 3) /elder：同意 → 輸入一句 → 回答氣泡截圖
  await page.getByTestId('role-elder').click();
  await agreeConsentIfShown(page);
  await page.getByTestId('text-input').fill('我啱啱血壓158/95，仲有啲頭暈');
  await page.getByTestId('send-button').click();
  await page.getByTestId('answer-bubble').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('answer-bubble').scrollIntoViewIfNeeded();
  await sleep(600);
  await page.screenshot({ path: path.join(briefDir, 'elder-answer.png') });
  console.log('[pdf] 截圖：/elder 回答氣泡');

  // 4) 快捷「量血壓」實際新增一筆（讓 /family/health 圖表多一個點）
  await page.getByTestId('quick-bp').click();
  await page.getByTestId('bp-systolic-input').fill('162');
  await page.getByTestId('bp-diastolic-input').fill('98');
  await page.getByTestId('bp-submit').click();
  await page.getByText('已經通知家人').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  await sleep(600);

  // 5) /family/health：血壓圖（含剛新增的點）截圖
  await page.goto(`${BASE}/#/family/health`);
  await agreeConsentIfShown(page);
  const bpSection = page.locator('section', { has: page.getByTestId('bp-chart') });
  await bpSection.waitFor({ state: 'visible', timeout: 20_000 });
  await sleep(900); // 等 recharts 動畫完成
  await bpSection.scrollIntoViewIfNeeded();
  await bpSection.screenshot({ path: path.join(briefDir, 'family-health-chart.png') });
  console.log('[pdf] 截圖：/family/health 血壓圖（含新增點）');

  // 6) /family/alerts：提醒列表截圖
  await page.goto(`${BASE}/#/family/alerts`);
  await agreeConsentIfShown(page);
  await page.getByTestId('family-alert-item').first().waitFor({ state: 'visible', timeout: 15_000 });
  await sleep(600);
  await page.screenshot({ path: path.join(briefDir, 'family-alerts.png') });
  console.log('[pdf] 截圖：/family/alerts 提醒列表');

  await browser.close();
  return briefDir;
}

async function main() {
  const args = parseArgs(process.argv);
  mkdirSync(DELIVERABLES, { recursive: true });

  await ensureBuild(args.build);
  const serverProc = await startServer();
  const previewProc = await startPreview();

  try {
    await captureScreenshots();
    if (!existsSync(path.join(WEB_DIR, 'dist', 'brief', 'elder-answer.png'))) {
      throw new Error('截圖未生成');
    }

    // QR / URL：有 --url 先驗證格式，再用 qrcode 包生成 data URL
    let query = '';
    if (args.url) {
      if (!/^https?:\/\//.test(args.url)) throw new Error(`--url 必須是 http(s) URL：${args.url}`);
      const qr = await QRCode.toDataURL(args.url, { width: 480, margin: 1, errorCorrectionLevel: 'M' });
      query = `?url=${encodeURIComponent(args.url)}&qr=${encodeURIComponent(qr)}`;
      console.log(`[pdf] 使用真實 URL：${args.url}`);
    } else {
      console.log('[pdf] 未提供 --url：PDF 內 URL/QR 以「待發布」佔位呈現');
    }

    // 打印 PDF
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.goto(`${BASE}/#/print-brief${query}`, { waitUntil: 'networkidle' });
    await page.getByTestId('print-brief').waitFor({ state: 'visible', timeout: 15_000 });
    // 等全部圖片載入完成（截圖已在 dist/brief/；載入失敗時 Shot 會自動換成佔位框）
    await page
      .waitForFunction(
        () => [...document.querySelectorAll('[data-testid="print-brief"] img')].every((im) => im.complete),
        { timeout: 8_000 },
      )
      .catch(() => undefined);
    await sleep(1200);

    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await browser.close();

    // 校驗頁數 ≤ 5
    const pdfDoc = await PDFDocument.load(readFileSync(OUT_PDF));
    const pages = pdfDoc.getPageCount();
    console.log(`[pdf] 已生成：${OUT_PDF}`);
    console.log(`[pdf] 頁數：${pages}（規範要求 ≤ 5）`);
    if (pages > 5) throw new Error(`PDF 頁數 ${pages} 超過 5 頁上限`);
  } finally {
    serverProc.kill();
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error('[pdf] 失敗：', err);
  process.exit(1);
});

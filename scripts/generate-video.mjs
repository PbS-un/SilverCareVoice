/**
 * scripts/generate-video.mjs（T11 交付物）
 *
 * 用 Playwright(chromium) 的 context recordVideo 錄製「真實操作、不剪接」的
 * 完整閉環 Demo，再以 ffmpeg 合成旁白 + 字幕：
 *   Demo Login（tester/tester）→ 四語言展示 → Demo Reset → 同意頁
 *   → /elder 輸入「我啱啱血壓158/95，仲有啲頭暈」→ 回答氣泡 + 自動 TTS
 *   → 今日狀態 → 快捷量血壓 → /family/health 圖表 → /family/alerts
 *   → 已跟進 → 回 /elder 見「家人已經知道 ✓」→ 結尾（三項重點 + 正式 URL）
 *
 * 產出：
 *   deliverables/demo.webm        （必需：含旁白音軌）
 *   deliverables/demo.mp4         （可選：H.264 版本）
 *   deliverables/demo.srt         （字幕 source）
 *   deliverables/demo-narration.txt（旁白逐字稿）
 *
 * 字幕：錄製期間以 DOM overlay 直接燒入畫面（burned-in Traditional Chinese），
 * 同時輸出 SRT；旁白：Windows SAPI（優先 zh-HK 廣東話，fallback 其他中文），
 * 合成後為「narrated voice-over」（非真人錄音）。
 *
 * 確定性：後端以空 DEEPSEEK_API_KEY 啟動（provider:local），
 * 全程不依賴真實 API Key；總長約 90–105 秒。
 *
 * 用法：node scripts/generate-video.mjs [--build]
 */
import {
  mkdirSync,
  renameSync,
  existsSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { ROOT, ensureBuild, startServer, startPreview, sleep } from './_lib.mjs';

const BASE = 'http://localhost:4173';
const DELIVERABLES = path.join(ROOT, 'deliverables');
const VIDEO_TMP = path.join(DELIVERABLES, '.video-tmp');
const OUT_VIDEO = path.join(DELIVERABLES, 'demo.webm');
const OUT_MP4 = path.join(DELIVERABLES, 'demo.mp4');
const OUT_SRT = path.join(DELIVERABLES, 'demo.srt');
const OUT_NARRATION = path.join(DELIVERABLES, 'demo-narration.txt');
const SAPI_SCRIPT = path.join(ROOT, 'scripts', '_sapi-tts.ps1');

/**
 * 故事板：每個 step 有 mark 名（時間基準）＋ 燒入畫面嘅字幕。
 * narration 為旁白逐字稿（zh-HK 廣東話，presentation 風格）。
 */
const SUBTITLES = {
  opening: '讓長者只說一句，讓 AI 把健康資訊連接到家人。',
  login: 'Demo Login — tester / tester',
  languages: '4 Languages｜繁中 · 简中 · Português · English',
  reset: '一鍵 Demo 重置，還原示範資料',
  consent: '進入長者端前先經免責同意',
  elder: '一句話 ↓ AI 理解 ↓ 健康紀錄 ↓ 風險判斷 ↓ 語音回答',
  tts: '系統會自動朗讀回答。（App 自動播放）',
  health: '健康資訊形成持續追蹤的記錄。',
  family: '不是聊天結束，而是家庭照護的開始。',
  alerts: '異常風險即時變成家屬提醒',
  followup: 'Elder → AI → Family → Follow-up → Elder',
  elder2: '家人已經知道 ✓',
  ending: '一句即用 · 家庭閉環 · 多語澳門｜https://pbs-un.github.io/SilverCareVoice/',
};

/** 旁白分段（每段對應一個 mark 起點；tts 段刻意留白俾 App 自動朗讀）。 */
const NARRATION = [
  { mark: 'opening', text: '銀髮一句通——一個為澳門長者設計嘅 AI 慢病照護同家庭守護平台。' },
  { mark: 'login', text: '打開即見 Demo 登入，輸入 tester、tester，一撳就入到系統。' },
  { mark: 'languages', text: '系統支援四種語言：繁中、簡中、葡文同英文，長者可以用最熟悉嘅語言。' },
  { mark: 'elder', text: '長者只需要講一句，系統就會理解健康資訊、建立結構化記錄、判斷風險，再用語音自動回應。' },
  { mark: 'health', text: '重要健康資訊唔會只留在對話，而會變成可以持續追蹤嘅健康記錄。' },
  { mark: 'family', text: 'SilverCare 同普通聊天機械人最大嘅分別，係重要對話會轉化成家屬真正可以跟進嘅健康事件。' },
  { mark: 'followup', text: '家屬完成跟進之後，長者會見到「家人已經知道」，成個照護閉環正式完成。' },
  { mark: 'ending', text: '一句即用、家庭閉環、多語澳門。歡迎掃碼體驗：pbs-un.github.io/SilverCareVoice。' },
];

function parseArgs(argv) {
  const args = { build: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--build') args.build = true;
  }
  return args;
}

/** 錄製期間把字幕燒入畫面（固定底部 overlay，隨影片一併錄入）。 */
async function setSubtitle(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('scv-subtitle');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scv-subtitle';
      el.style.cssText =
        'position:fixed;left:0;right:0;bottom:96px;z-index:99999;display:flex;justify-content:center;pointer-events:none;';
      const box = document.createElement('div');
      box.style.cssText =
        'background:rgba(0,0,0,0.72);color:#fff;font-family:"Microsoft JhengHei","Microsoft YaHei","Noto Sans TC","Noto Sans SC",sans-serif;' +
        'font-size:19px;font-weight:700;line-height:1.55;padding:9px 16px;border-radius:10px;' +
        'max-width:90%;text-align:center;word-break:break-word;';
      el.appendChild(box);
      document.body.appendChild(el);
    }
    el.firstChild.textContent = t;
  }, text);
}

async function agreeConsentIfShown(page) {
  const btn = page.getByTestId('consent-agree');
  await btn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await btn.isVisible().catch(() => false)) {
    await sleep(900); // 讓觀眾看清同意頁
    await btn.click();
  }
}

/** 用 Windows SAPI（優先 zh-HK 廣東話）為每段旁白生成 WAV。 */
function generateNarrationAudio(segments) {
  const segDir = path.join(VIDEO_TMP, 'narration');
  mkdirSync(segDir, { recursive: true });
  const jsonPath = path.join(segDir, 'segments.json');
  writeFileSync(jsonPath, JSON.stringify(segments.map((s, i) => ({ id: i, text: s.text })), null, 2), 'utf8');
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SAPI_SCRIPT, '-JsonPath', jsonPath, '-OutDir', segDir],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (res.status !== 0) {
    throw new Error(`SAPI TTS 失敗：${(res.stderr || res.stdout || '').slice(0, 300)}`);
  }
  return segDir;
}

/** ffprobe 讀 WAV 時長（秒）。 */
function wavDuration(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
    encoding: 'utf8',
  });
  const n = Number.parseFloat((res.stdout || '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** 用 ffmpeg 將旁白按 mark 時間合成音軌，再 mux 到影片。 */
function composeVideo(rawWebm, narrationSegs, audioDir) {
  const args = ['-y', '-i', rawWebm];
  const filters = [];
  const inputs = [];
  narrationSegs.forEach((seg, i) => {
    const wav = path.join(audioDir, `seg-${i}.wav`);
    args.push('-i', wav);
    const startMs = Math.round(seg.at * 1000);
    filters.push(`[${i + 1}:a]adelay=${startMs}|${startMs}[a${i}]`);
    inputs.push(`[a${i}]`);
  });
  if (inputs.length === 0) throw new Error('無旁白分段');
  filters.push(`${inputs.join('')}amix=inputs=${inputs.length}:normalize=0[aout]`);

  // demo.webm（VP9 + Opus，保留音軌）
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libvpx-vp9', '-b:v', '1.2M', '-c:a', 'libopus',
    '-shortest', OUT_VIDEO,
  );
  const webmRes = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 600_000 });
  if (webmRes.status !== 0) {
    throw new Error(`ffmpeg webm 合成失敗：${(webmRes.stderr || '').slice(-800)}`);
  }

  // demo.mp4（H.264 + AAC）
  const mp4Args = [
    '-y', '-i', rawWebm,
    ...narrationSegs.flatMap((_, i) => ['-i', path.join(audioDir, `seg-${i}.wav`)]),
    '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main',
    '-c:a', 'aac', '-shortest', OUT_MP4,
  ];
  const mp4Res = spawnSync('ffmpeg', mp4Args, { encoding: 'utf8', timeout: 600_000 });
  if (mp4Res.status !== 0) {
    console.warn(`[video] mp4 合成失敗（可選產物，忽略）：${(mp4Res.stderr || '').slice(-400)}`);
  }
}

/** SRT 時間格式。 */
function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(milli, 3)}`;
}

/** 由 marks 生成 SRT。 */
function buildSrt(marks, total) {
  const lines = [];
  let idx = 1;
  for (let i = 0; i < marks.length; i += 1) {
    const m = marks[i];
    if (!SUBTITLES[m.name]) continue;
    const end = i + 1 < marks.length ? marks[i + 1].at : total;
    lines.push(String(idx++));
    lines.push(`${srtTime(m.at)} --> ${srtTime(Math.max(end, m.at + 1.5))}`);
    lines.push(SUBTITLES[m.name]);
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  mkdirSync(DELIVERABLES, { recursive: true });
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });

  await ensureBuild(args.build);
  const serverProc = await startServer();
  const previewProc = await startPreview();

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      recordVideo: { dir: VIDEO_TMP, size: { width: 432, height: 936 } },
    });
    const page = await ctx.newPage();
    const recStart = Date.now();
    const marks = [];
    const mark = async (name) => {
      const at = (Date.now() - recStart) / 1000;
      marks.push({ name, at });
      if (SUBTITLES[name]) await setSubtitle(page, SUBTITLES[name]);
    };

    /* 1) 開場：Demo Login（品牌頁） */
    await page.goto(`${BASE}/`);
    await page.getByTestId('demo-login-form').waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(2_500);
    await mark('opening');
    await sleep(2_500);

    /* 2) Demo Login：tester / tester */
    await page.getByTestId('demo-login-id').click();
    await page.getByTestId('demo-login-id').pressSequentially('tester', { delay: 110 });
    await page.getByTestId('demo-login-password').click();
    await page.getByTestId('demo-login-password').pressSequentially('tester', { delay: 110 });
    await sleep(700);
    await mark('login');
    await page.getByTestId('demo-login-submit').click();
    await page.getByTestId('role-elder').waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(1_200);

    /* 3) 四語言切換展示（最後回繁體中文） */
    await page.getByTestId('language-selector').selectOption('en');
    await sleep(1_400);
    await page.getByTestId('language-selector').selectOption('pt');
    await sleep(1_400);
    await page.getByTestId('language-selector').selectOption('zh-CN');
    await sleep(1_400);
    await page.getByTestId('language-selector').selectOption('zh-HK');
    await sleep(700);
    await mark('languages');
    await sleep(1_600);

    /* 4) Demo Reset */
    await page.getByTestId('demo-reset').click();
    await sleep(900);
    await page.getByTestId('demo-reset-confirm').click();
    await page.getByText('已重置為示範資料').waitFor({ timeout: 30_000 });
    await mark('reset');
    await sleep(1_800);

    /* 5) 進入長者端 → 同意頁 */
    await page.getByTestId('role-elder').click();
    await agreeConsentIfShown(page);
    await mark('consent');
    await sleep(1_300);

    /* 6) 一句輸入 → 回答（完成後自動朗讀一次） */
    await page.getByTestId('text-input').click();
    await page.getByTestId('text-input').pressSequentially('我啱啱血壓158/95，仲有啲頭暈', { delay: 100 });
    await sleep(800);
    await page.getByTestId('send-button').click();
    await page.getByTestId('answer-bubble').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('answer-bubble').scrollIntoViewIfNeeded();
    await sleep(1_000);
    await mark('elder');
    await sleep(5_000); // 讓觀眾閱讀回答

    /* 7) Auto TTS 時刻：旁白留白，字幕說明系統自動朗讀 */
    await mark('tts');
    await sleep(4_000);

    /* 8) 今日狀態 */
    await page.getByTestId('today-status').scrollIntoViewIfNeeded();
    await mark('health');
    await sleep(4_000);

    /* 9) 快捷「量血壓」→ 實際新增一筆（圖表新點的來源） */
    await page.getByTestId('quick-bp').click();
    await sleep(900);
    await page.getByTestId('bp-systolic-input').fill('162');
    await page.getByTestId('bp-diastolic-input').fill('98');
    await sleep(700);
    await page.getByTestId('bp-submit').click();
    await page.getByText('已經通知家人').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await sleep(2_000);

    /* 10) 家屬端：健康趨勢（圖表出現新點） */
    await page.goto(`${BASE}/#/family/health`);
    await agreeConsentIfShown(page);
    await page
      .locator('section', { has: page.getByTestId('bp-chart') })
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('section', { has: page.getByTestId('bp-chart') }).scrollIntoViewIfNeeded();
    await mark('family');
    await sleep(6_000);

    /* 11) 家屬端：提醒列表（新 Alert） */
    await page.goto(`${BASE}/#/family/alerts`);
    await page.getByTestId('family-alert-item').first().waitFor({ state: 'visible', timeout: 15_000 });
    await mark('alerts');
    await sleep(3_500);

    /* 12) 已跟進 */
    await page.getByTestId('followup-button').first().click();
    await sleep(1_000);
    await page.getByTestId('followup-type-visit').click();
    await sleep(600);
    await page.getByTestId('followup-note').fill('已致電長者，安排明日陪佢去衛生中心覆診。');
    await sleep(900);
    await page.getByTestId('followup-submit').click();
    await page.getByText('已記低跟進').waitFor({ timeout: 15_000 });
    await mark('followup');
    await sleep(4_000);

    /* 13) 回長者端：家人已經知道 ✓ */
    await page.goto(`${BASE}/#/elder`);
    await page.getByTestId('today-status').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('today-status').scrollIntoViewIfNeeded();
    await page.getByText('家人已經知道').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await mark('elder2');
    await sleep(3_000);

    /* 14) 結尾：三項重點 + 正式 URL */
    await mark('ending');
    await sleep(8_000);

    /* 收尾：先取影片句柄，再關閉 context 使影片落盤 */
    const video = page.video();
    await page.close();
    await ctx.close();
    await browser.close();

    if (!video) throw new Error('未取得錄影片段');
    const rawSrc = await video.path();
    if (!existsSync(rawSrc)) throw new Error(`錄製檔案不存在：${rawSrc}`);
    const rawWebm = path.join(VIDEO_TMP, 'raw.webm');
    renameSync(rawSrc, rawWebm);

    const totalSec = (Date.now() - recStart) / 1000;
    // 只保留有字幕的 marks 做 SRT
    const srt = buildSrt(marks, totalSec);
    writeFileSync(OUT_SRT, srt, 'utf8');
    writeFileSync(OUT_NARRATION, NARRATION.map((s) => s.text).join('\n'), 'utf8');
    console.log(`[video] 錄製完成：${Math.round(totalSec)}s，marks=${marks.length}`);

    // 旁白合成（失敗則保留純畫面影片，不阻斷交付）
    let composed = false;
    try {
      const audioDir = generateNarrationAudio(NARRATION);
      const narrationSegs = NARRATION.map((seg) => {
        const found = marks.find((m) => m.name === seg.mark);
        return { ...seg, at: found ? found.at : 0 };
      }).filter((s) => s.at >= 0);
      composeVideo(rawWebm, narrationSegs, audioDir);
      composed = true;
    } catch (err) {
      console.warn(`[video] 旁白合成失敗，輸出純畫面版本：${err.message}`);
      if (existsSync(OUT_VIDEO)) rmSync(OUT_VIDEO);
      renameSync(rawWebm, OUT_VIDEO);
    }

    if (composed) rmSync(rawWebm, { force: true });
    rmSync(VIDEO_TMP, { recursive: true, force: true });

    const sizeMb = (statSync(OUT_VIDEO).size / 1048576).toFixed(1);
    console.log(`[video] 已生成：${OUT_VIDEO}`);
    console.log(`[video] 影片時長約 ${Math.round(totalSec)} 秒（目標 60–120 秒），檔案 ${sizeMb} MB`);
    console.log(`[video] 字幕：${OUT_SRT}`);
    console.log(`[video] 旁白：${OUT_NARRATION}（narrated voice-over，Windows SAPI 合成）`);
    if (existsSync(OUT_MP4)) console.log(`[video] 可選 mp4：${OUT_MP4}`);
  } finally {
    serverProc.kill();
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error('[video] 失敗：', err);
  process.exit(1);
});

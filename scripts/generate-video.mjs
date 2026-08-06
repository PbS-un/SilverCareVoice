/**
 * scripts/generate-video.mjs（T11）— 3 分鐘比賽影片
 *
 * 規格：
 *  - 9:16 豎屏 1080×1920 @ 30fps，總時長嚴格 180.0 秒（ffprobe 驗證）
 *  - 輸出：deliverables/demo.mp4（H.264+AAC）、demo.webm（VP9+Opus）
 *  - 字幕：雙行（第一行繁體中文／粵語語氣，第二行简体普通话），
 *    錄製期間以 DOM overlay 燒入畫面，另輸出 demo.srt
 *  - 旁白：粵語為主（Windows SAPI zh-HK，synthetic narrated voice-over），
 *    輸出 demo-narration.txt；自動 TTS 時段刻意留白
 *  - BGM：scripts/_bgm.mjs 生成嘅原創舒緩鋼琴感琶音（royalty-free by construction），
 *    音量低於旁白
 *  - 真人鏡頭：無合法素材時用「warm visual placeholder」+ VIDEO_LIVE_ACTION_SHOTLIST.md
 *
 * 內容比例：真人／human story 30%（placeholder，可替換），APP／UI 70%（真實操作錄屏）。
 * 真實操作包含：Demo 長者選擇器登入、慢速語音（scripted ASR chunks + 8 秒停頓）、
 * AI 回答＋自動 TTS、家庭提醒＋跟進＋回流、四語言切換。
 *
 * 用法：node scripts/generate-video.mjs [--build]
 */
import {
  mkdirSync,
  renameSync,
  existsSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { ROOT, ensureBuild, startServer, startPreview, sleep } from './_lib.mjs';

const BASE = 'http://localhost:4173';
const DELIVERABLES = path.join(ROOT, 'deliverables');
const VIDEO_TMP = path.join(DELIVERABLES, '.video-tmp');
const OUT_MP4 = path.join(DELIVERABLES, 'demo.mp4');
const OUT_WEBM = path.join(DELIVERABLES, 'demo.webm');
const OUT_SRT = path.join(DELIVERABLES, 'demo.srt');
const OUT_NARRATION = path.join(DELIVERABLES, 'demo-narration.txt');
const OUT_SHOTLIST = path.join(DELIVERABLES, 'VIDEO_LIVE_ACTION_SHOTLIST.md');
const SAPI_SCRIPT = path.join(ROOT, 'scripts', '_sapi-tts.ps1');
const BGM_SCRIPT = path.join(ROOT, 'scripts', '_bgm.mjs');

const W = 1080;
const H = 1920;
const TARGET_SEC = 180;

/** 雙行字幕（繁中 / 简中，自然表達，唔逐字機械翻譯）。 */
const SUBS = {
  intro: ['慢病記錄難｜跨語言溝通｜家人不能即時掌握狀況', '慢病记录难｜跨语言沟通｜家人无法及时掌握情况'],
  login: ['讓長者只說一句，讓家人少一份擔心', '让长者只说一句，让家人少一份担心'],
  slow: ['一句話 ↓ AI 理解 ↓ 健康紀錄 ↓ 風險判斷 ↓ 語音回答', '一句话 ↓ AI理解 ↓ 健康记录 ↓ 风险判断 ↓ 语音回答'],
  tts: ['系統會自動朗讀回答（8 秒內停頓都會繼續聽）', '系统会自动朗读回答（8秒内停顿都会继续听）'],
  family: ['不是聊天結束，而是家庭照護的開始', '不是聊完就结束，而是家庭照护的开始'],
  lang: ['繁中 · 简中 · Português · English', '繁中 · 简中 · Português · English'],
  local: ['Local-first｜離線可用｜聯網協同｜隱私優先', 'Local-first｜离线可用｜联网协同｜隐私优先'],
  social: ['一句即用｜澳門四語｜家人真正接得上｜斷網有保障', '一句即用｜澳门四语｜家人真正接得上｜断网有保障'],
  future: ['讓長者只說一句，讓家人少一份擔心', '让长者只说一句，让家人少一份担心'],
  ending: ['https://pbs-un.github.io/SilverCareVoice/', 'https://pbs-un.github.io/SilverCareVoice/'],
};

/** 旁白（粵語為主；tts 段留白俾 App 自動朗讀）。 */
const NARRATION = [
  { mark: 'intro', text: '澳門好多長者，每日都要自己記血壓、記血糖；量完數字唔知點算，想話畀仔女知，又唔識用複雜嘅手機 App。' },
  { mark: 'login', text: '銀髮一句通，一個為澳門長者設計嘅 AI 慢病家庭照護平台。揀一位示範長者，一撳就入到系統。' },
  { mark: 'slow', text: '長者只需要講一句。就算中間停一停，系統都會耐心聽住，等你慢慢講完，再一次性理解、記錄、判斷風險，再用語音答返你。' },
  { mark: 'family', text: '有異常，系統會即刻通知家人。家屬睇到提醒、跟進之後，長者會見到「家人已經知道」，成個照護閉環正式完成。' },
  { mark: 'lang', text: '澳門同時有粵語、普通話、葡語同英文使用者。銀髮一句通由輸入、AI 回覆到語音輸出都跟隨語言。' },
  { mark: 'local', text: '資料先存在長者自己部機度，斷網都照樣記錄；要同家人協同嘅時候，再透過同步服務連埋一齊。' },
  { mark: 'social', text: '銀髮一句通唔係普通聊天機械人，而係將語音、健康紀錄、風險提醒同家庭跟進連成一條完整流程，降低長者數碼門檻，亦幫助家庭層面整理非緊急健康資訊。' },
  { mark: 'future', text: '未來，我哋希望接入穿戴裝置、醫院同社工，甚至建立合規匿名嘅長者健康資料庫。用一句語音降低數碼門檻，用 AI 將健康資訊連接到家庭，讓科技真正走進澳門長者每日嘅生活。' },
];

function parseArgs(argv) {
  return { build: argv.includes('--build') };
}

/** 錄製期間把雙行字幕燒入畫面（固定底部 overlay）。 */
async function setSubtitle(page, zh, zhCN) {
  await page.evaluate(
    ([a, b]) => {
      let el = document.getElementById('scv-subtitle');
      if (!el) {
        el = document.createElement('div');
        el.id = 'scv-subtitle';
        el.style.cssText =
          'position:fixed;left:0;right:0;bottom:64px;z-index:99999;display:flex;justify-content:center;pointer-events:none;';
        el.appendChild(document.createElement('div'));
        document.body.appendChild(el);
      }
      const box = el.firstChild;
      box.style.cssText =
        'background:rgba(15,23,42,0.78);color:#fff;font-family:"Microsoft JhengHei","Microsoft YaHei","Noto Sans TC","Noto Sans SC",sans-serif;' +
        'font-size:34px;font-weight:700;line-height:1.5;padding:14px 24px;border-radius:16px;max-width:92%;text-align:center;word-break:break-word;';
      box.innerHTML = `${a}<br/><span style="opacity:0.82;font-size:28px">${b}</span>`;
    },
    [zh, zhCN],
  );
}

/** 真人鏡頭替代：溫暖、低飽和、人文感嘅 project visual placeholder。 */
async function showVisual(page, { kicker, title, lines, accent = '#5ba3d0' }) {
  await page.evaluate(
    ({ kicker, title, lines, accent }) => {
      const root = document.getElementById('root');
      if (root) root.style.display = 'none';
      let panel = document.getElementById('scv-visual');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'scv-visual';
        panel.style.cssText =
          'position:fixed;inset:0;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'background:linear-gradient(160deg,#f6efe4 0%,#fbf7ef 45%,#eef3f6 100%);color:#1f2937;text-align:center;padding:60px 72px;';
        document.body.appendChild(panel);
      }
      panel.innerHTML =
        `<p style="margin:0 0 20px;font-size:24px;letter-spacing:0.35em;font-weight:700;color:${accent};text-transform:uppercase">${kicker}</p>` +
        `<h1 style="margin:0 0 36px;font-size:64px;font-weight:900;line-height:1.3;font-family:'Microsoft JhengHei','Microsoft YaHei',sans-serif">${title}</h1>` +
        lines
          .map(
            (l) =>
              `<p style="margin:0 0 18px;font-size:34px;font-weight:700;color:#4b5563;line-height:1.6">${l}</p>`,
          )
          .join('') +
        `<p style="margin:48px 0 0;font-size:20px;color:#9ca3af">SilverCare Macau — 灣區 AI 未來青年創造營</p>`;
    },
    { kicker, title, lines, accent },
  );
}

/** 隱藏 placeholder，回到真實 App。 */
async function hideVisual(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('scv-visual');
    if (panel) panel.remove();
    const root = document.getElementById('root');
    if (root) root.style.display = '';
  });
}

/** 注入 scripted SpeechRecognition stub：模擬長者斷句語音（中間停頓）。 */
async function installSpeechStub(page) {
  await page.addInitScript(() => {
    const w = window;
    class ScriptedRecognition {
      constructor() {
        this.lang = 'zh-HK';
        this.interimResults = true;
        this.continuous = true;
        this.onstart = null;
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this._timers = [];
      }
      _emit(interim, final) {
        const transcript = final ?? interim ?? '';
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: Boolean(final), 0: { transcript } }],
        });
      }
      _after(ms, fn) {
        this._timers.push(setTimeout(fn, ms));
      }
      start() {
        this.onstart?.({});
        this._after(600, () => this._emit('今日血壓'));
        this._after(2600, () => this._emit(null, '今日血壓'));
        this._after(3400, () => this._emit('一百五十八'));
        this._after(5200, () => this._emit(null, '一百五十八'));
        this._after(5800, () => this._emit('九十五'));
        this._after(7400, () => this._emit(null, '九十五'));
        this._after(8200, () => this._emit('有少少頭暈'));
        this._after(9800, () => this._emit(null, '有少少頭暈'));
        // 之後靜音 —— 由 App 嘅 8 秒 silence 計時器收尾
      }
      stop() {
        this._timers.forEach((t) => clearTimeout(t));
        this.onend?.({});
      }
      abort() {
        this._timers.forEach((t) => clearTimeout(t));
        this.onend?.({});
      }
    }
    try {
      Object.defineProperty(w, 'SpeechRecognition', { value: ScriptedRecognition, configurable: true });
      Object.defineProperty(w, 'webkitSpeechRecognition', { value: ScriptedRecognition, configurable: true });
    } catch {
      /* 極端環境 */
    }
  });
}

async function agreeConsentIfShown(page) {
  const btn = page.getByTestId('consent-agree');
  await btn.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
  if (await btn.isVisible().catch(() => false)) {
    await sleep(900);
    await btn.click();
  }
}

/** SAPI 生成旁白 WAV（每段一個）。 */
function generateNarrationAudio(segments) {
  const segDir = path.join(VIDEO_TMP, 'narration');
  mkdirSync(segDir, { recursive: true });
  const jsonPath = path.join(segDir, 'segments.json');
  writeFileSync(jsonPath, JSON.stringify(segments.map((s, i) => ({ id: i, text: s.text })), null, 2), 'utf8');
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SAPI_SCRIPT, '-JsonPath', jsonPath, '-OutDir', segDir],
    { encoding: 'utf8', timeout: 180_000 },
  );
  if (res.status !== 0) throw new Error(`SAPI TTS 失敗：${(res.stderr || res.stdout || '').slice(0, 300)}`);
  return segDir;
}

function wavDuration(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
    encoding: 'utf8',
  });
  const n = Number.parseFloat((res.stdout || '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** ffmpeg 合成：旁白 + BGM → 音軌；影片固定 1080×1920@30、精確 180.0s。 */
function composeVideo(rawWebm, narrationSegs, audioDir, bgmWav) {
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1f2937`;
  const common = [
    '-y',
    '-i', rawWebm,
    '-i', bgmWav,
    ...narrationSegs.flatMap((_, i) => ['-i', path.join(audioDir, `seg-${i}.wav`)]),
  ];
  const filters = [`[1:a]volume=0.30[bgm]`];
  const narrInputs = [];
  narrationSegs.forEach((seg, i) => {
    const startMs = Math.round(seg.at * 1000);
    filters.push(`[${i + 2}:a]adelay=${startMs}|${startMs}[n${i}]`);
    narrInputs.push(`[n${i}]`);
  });
  filters.push(
    `${narrInputs.join('')}amix=inputs=${narrInputs.length}:normalize=0[narr]`,
    `[narr][bgm]amix=inputs=2:normalize=0[aout]`,
  );

  const base = [...common, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-vf', vf, '-r', '30', '-t', String(TARGET_SEC)];

  const mp4Args = [...base, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-b:v', '5M', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT_MP4];
  const mp4Res = spawnSync('ffmpeg', mp4Args, { encoding: 'utf8', timeout: 900_000 });
  if (mp4Res.status !== 0) throw new Error(`ffmpeg mp4 失敗：${(mp4Res.stderr || '').slice(-900)}`);

  const webmArgs = [...base, '-c:v', 'libvpx-vp9', '-b:v', '4M', '-c:a', 'libopus', OUT_WEBM];
  const webmRes = spawnSync('ffmpeg', webmArgs, { encoding: 'utf8', timeout: 900_000 });
  if (webmRes.status !== 0) throw new Error(`ffmpeg webm 失敗：${(webmRes.stderr || '').slice(-900)}`);
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const p = (n, w) => String(n).padStart(w, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(milli, 3)}`;
}

function buildSrt(marks) {
  const lines = [];
  let idx = 1;
  for (let i = 0; i < marks.length; i += 1) {
    const m = marks[i];
    if (!SUBS[m.name]) continue;
    const end = i + 1 < marks.length ? marks[i + 1].at : TARGET_SEC;
    lines.push(String(idx++));
    lines.push(`${srtTime(m.at)} --> ${srtTime(Math.min(TARGET_SEC, Math.max(end, m.at + 2)))}`);
    lines.push(`${SUBS[m.name][0]}\n${SUBS[m.name][1]}`);
    lines.push('');
  }
  return lines.join('\n');
}

const SHOTLIST = `# VIDEO_LIVE_ACTION_SHOTLIST

本影片為「澳門本土溫情紀事科技風」設計；由於 repository 內沒有可合法使用嘅真人長者影片素材，
00:00–00:10、01:50–02:10、02:10–02:40、02:40–03:00 目前使用 warm visual placeholder
（暖色、低飽和 project visual）。以下列出之後應替換為真人鏡頭嘅位置、秒數與構圖建議。

| 時間 | 段落 | 建議鏡頭內容 | 構圖 |
| --- | --- | --- | --- |
| 00:00–00:05 | 痛點：婆婆量血壓 | 澳門舊區家中，婆婆自己用血壓計量血壓，望住數字面露疑惑 | 中景，暖光，窗邊自然光 |
| 00:05–00:10 | 痛點：想通知子女 | 婆婆拿起手機，表情為難，唔識操作 | 近景（過肩），手機半入鏡 |
| 02:40–02:45 | 社會價值 | 子女同婆婆一齊睇手機，婆婆微笑 | 雙人中景，家庭溫馨光 |
| 02:45–02:50 | 社會價值 | 家屬打緊電話關心長者 | 近景，手機貼耳 |
| 02:50–03:00 | 結尾 | 婆婆同家人喺梳化一齊睇住手機上嘅健康紀錄 | 遠景收尾，暖黃色調，定格 |

替換原則：所有真人鏡頭必須有明確授權／授權拍攝；冇授權前保留 placeholder，唔可以假裝為真實紀錄片。
`;

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
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      recordVideo: { dir: VIDEO_TMP, size: { width: W, height: H } },
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('scv.consent.v1', '1');
    });
    await installSpeechStub(page);

    const recStart = Date.now();
    const marks = [];
    const mark = async (name) => {
      const at = (Date.now() - recStart) / 1000;
      marks.push({ name, at });
      if (SUBS[name]) await setSubtitle(page, SUBS[name][0], SUBS[name][1]);
    };

    /* ── 0:00–0:10 痛點（warm visual placeholder）── */
    await page.goto(`${BASE}/`);
    await page.getByTestId('demo-login-form').waitFor({ state: 'visible', timeout: 60_000 });
    await showVisual(page, {
      kicker: '澳門 · 銀髮日常',
      title: '每日量血壓，<br/>數字之後點算？',
      lines: ['慢病記錄難', '跨語言溝通', '家人不能即時掌握狀況'],
    });
    await mark('intro');
    await sleep(10_000);

    /* ── 0:10–0:30 切入 SilverCare（真實 App：Demo 長者選擇器）── */
    await hideVisual(page);
    await sleep(1_200);
    await page.getByTestId('demo-elder-select').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('demo-elder-select').selectOption('seed-elder-01');
    await sleep(2_000);
    await mark('login');
    await sleep(4_000);
    await page.getByTestId('demo-login-submit').click();
    await page.getByTestId('role-elder').waitFor({ state: 'visible', timeout: 30_000 });
    // 快速四語言（開場展示）
    await page.getByTestId('language-selector').selectOption('en');
    await sleep(1_000);
    await page.getByTestId('language-selector').selectOption('pt');
    await sleep(1_000);
    await page.getByTestId('language-selector').selectOption('zh-CN');
    await sleep(1_000);
    await page.getByTestId('language-selector').selectOption('zh-HK');
    await sleep(3_000);

    /* ── 0:30–1:00 核心創新 1：一句式慢速語音輸入（真實 App + scripted ASR）── */
    await page.getByTestId('role-elder').click();
    await agreeConsentIfShown(page);
    await page.getByTestId('text-input').waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(1_000);
    await mark('slow');
    // 撳咪 → stub 分四段講（中間有停頓）→ 8 秒 silence 收尾 → AI 回答 + 自動 TTS
    await page.getByTestId('mic-button').click();
    await sleep(16_000); // 等足 stub 發聲 + 8 秒 silence + AI 處理
    await page.getByTestId('answer-bubble').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
    await page.getByTestId('answer-bubble').scrollIntoViewIfNeeded();
    await sleep(3_000);
    await mark('tts');
    await sleep(5_000); // 自動朗讀時段，旁白留白
    await page.getByTestId('today-status').scrollIntoViewIfNeeded();
    await sleep(4_000);

    /* ── 1:00–1:30 核心創新 2：家庭照護閉環（真實 App）── */
    await page.goto(`${BASE}/#/family/alerts`);
    await page.getByTestId('family-alert-item').first().waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(1_500);
    await mark('family');
    await sleep(5_000);
    await page.getByTestId('followup-button').first().click();
    await sleep(1_000);
    await page.getByTestId('followup-type-visit').click();
    await sleep(600);
    await page.getByTestId('followup-note').fill('已致電長者，安排明日陪佢覆診。');
    await sleep(1_000);
    await page.getByTestId('followup-submit').click();
    await page.getByText('已記低跟進').waitFor({ timeout: 15_000 });
    await sleep(3_000);
    await page.goto(`${BASE}/#/elder`);
    await page.getByTestId('today-status').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText('家人已經知道').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await sleep(4_000);

    /* ── 1:30–1:50 核心創新 3：澳門四語（真實 App 快速切換）── */
    await page.goto(`${BASE}/#/`);
    await page.getByTestId('role-elder').waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(800);
    await mark('lang');
    await page.getByTestId('language-selector').selectOption('zh-CN');
    await sleep(2_000);
    await page.getByTestId('language-selector').selectOption('pt');
    await sleep(2_000);
    await page.getByTestId('language-selector').selectOption('en');
    await sleep(2_000);
    await page.getByTestId('language-selector').selectOption('zh-HK');
    await sleep(2_000);

    /* ── 1:50–2:10 Local-first + Cloud（warm visual placeholder）── */
    await showVisual(page, {
      kicker: 'Local-first + Cloud',
      title: '斷網都有基本保障<br/>聯網就可以協同',
      lines: ['① 離線／純前端', '② 本地網絡雙裝置', '③ 雲端跨網協同'],
    });
    await mark('local');
    await sleep(12_000);

    /* ── 2:10–2:40 差異化＋社會價值（warm visual placeholder）── */
    await showVisual(page, {
      kicker: '差異化 · 社會價值',
      title: '一句就識用，家人真正接得上',
      lines: [
        '慢病：每日小量數據形成長期紀錄',
        '獨居：重要異常家屬有機會知道',
        '數碼門檻：唔使學複雜操作',
        '醫療分流：初步整理，唔取代醫生',
      ],
    });
    await mark('social');
    await sleep(14_000);

    /* ── 2:40–3:00 未來願景 + 結尾（warm visual placeholder）── */
    await showVisual(page, {
      kicker: 'FUTURE VISION',
      title: '未來願景',
      lines: [
        'Wearable 自動化 → 風險監測',
        '社工 ＋ 醫院 ＋ 家庭三方協同',
        '合規匿名長者健康資料庫',
        '線上家庭醫生',
      ],
    });
    await mark('future');
    await sleep(8_000);
    await showVisual(page, {
      kicker: '銀髮一句通 SilverCare Macau',
      title: '讓長者只說一句<br/>讓家人少一份擔心',
      lines: ['https://pbs-un.github.io/SilverCareVoice/'],
      accent: '#3e7ea6',
    });
    await mark('ending');
    await sleep(10_000);

    /* 收尾：錄到約 185s，ffmpeg 再裁到精確 180.0s */
    const elapsed = (Date.now() - recStart) / 1000;
    if (elapsed < TARGET_SEC + 5) await sleep((TARGET_SEC + 5 - elapsed) * 1000);

    const video = page.video();
    await page.close();
    await ctx.close();
    await browser.close();

    if (!video) throw new Error('未取得錄影片段');
    const rawSrc = await video.path();
    const rawWebm = path.join(VIDEO_TMP, 'raw.webm');
    renameSync(rawSrc, rawWebm);

    const totalSec = (Date.now() - recStart) / 1000;
    writeFileSync(OUT_SRT, buildSrt(marks), 'utf8');
    writeFileSync(OUT_NARRATION, NARRATION.map((s) => s.text).join('\n'), 'utf8');
    writeFileSync(OUT_SHOTLIST, SHOTLIST, 'utf8');
    console.log(`[video] 錄製完成：${Math.round(totalSec)}s（將裁至 ${TARGET_SEC}s），marks=${marks.length}`);

    // BGM（原創）
    const bgmWav = path.join(VIDEO_TMP, 'bgm.wav');
    const bgmRes = spawnSync('node', [BGM_SCRIPT, bgmWav, String(TARGET_SEC)], { encoding: 'utf8', timeout: 120_000 });
    if (bgmRes.status !== 0) throw new Error(`BGM 生成失敗：${(bgmRes.stderr || bgmRes.stdout || '').slice(0, 300)}`);

    // 旁白
    const audioDir = generateNarrationAudio(NARRATION);
    const narrationSegs = NARRATION.map((seg) => {
      const found = marks.find((m) => m.name === seg.mark);
      return { ...seg, at: found ? found.at : 0 };
    });
    composeVideo(rawWebm, narrationSegs, audioDir, bgmWav);

    rmSync(VIDEO_TMP, { recursive: true, force: true });

    const sizeMb = (statSync(OUT_MP4).size / 1048576).toFixed(1);
    console.log(`[video] 已生成：${OUT_MP4}（${sizeMb} MB）、${OUT_WEBM}`);
    console.log(`[video] 字幕：${OUT_SRT}；旁白：${OUT_NARRATION}（narrated voice-over，SAPI zh-HK 合成）`);
    console.log(`[video] 真人鏡頭 shotlist：${OUT_SHOTLIST}`);
  } finally {
    serverProc.kill();
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error('[video] 失敗：', err);
  process.exit(1);
});

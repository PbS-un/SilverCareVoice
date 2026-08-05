/**
 * scripts 共用工具（T11）：執行外部命令、啟動 server / vite preview、
 * 等待 URL、清理進程。供 generate-pdf.mjs / generate-video.mjs 使用。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = path.join(ROOT, 'web');

/** 執行命令並等待結束（繼承 stdio，失敗即拋錯）。 */
export async function run(cmd, args, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  console.log(`[run] ${cmd} ${args.join(' ')}  (cwd: ${path.relative(ROOT, cwd) || '.'})`);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0] ?? ''} 退出碼 ${code}`));
    });
  });
}

/** 背景啟動進程，回傳 { child, kill }。 */
export function spawnBg(cmd, args, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    child,
    kill() {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32') {
        // Windows：連子進程樹一併終止
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { /* ignore */ }
      } else {
        child.kill('SIGTERM');
      }
    },
  };
}

/** 輪詢等待 URL 可達。 */
export async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch { /* 未就緒，繼續等 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待 ${url} 逾時（${timeoutMs}ms）`);
}

/**
 * 啟動後端 server（8787）。
 * 確定性：DEEPSEEK_API_KEY 強制設空字串 —— dotenv 不會覆蓋已存在的
 * 環境變數，故 server 一律走 provider:local（LocalHybridEngine），
 * 產出物不依賴真實 API Key。
 * 安全：啟動前先確認 8787 未被佔用 —— 若已有 server（可能帶真實 Key），
 * 直接報錯，避免產物腳本靜默連到不確定性後端。
 */
export async function startServer() {
  try {
    const res = await fetch('http://localhost:8787/api/health', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      throw new Error(
        '埠 8787 已被另一個 server 佔用（可能載入了真實 DEEPSEEK_API_KEY）。' +
          '請先停止該 dev server 再執行產物腳本，確保 provider:local 確定性。',
      );
    }
  } catch (err) {
    if (err?.message?.includes('埠 8787 已被另一個 server 佔用')) throw err;
    // 其餘錯誤（拒絕連線／逾時）＝埠未被佔用，正常繼續
  }
  const proc = spawnBg('node', ['index.mjs'], {
    cwd: path.join(ROOT, 'server'),
    env: { DEEPSEEK_API_KEY: '' },
  });
  await waitForUrl('http://localhost:8787/api/health');
  console.log('[lib] server ready (8787, provider:local)');
  return proc;
}

/** 確保 web/dist 已構建（含最新 PrintBrief 頁）。 */
export async function ensureBuild(force = false) {
  const distIndex = path.join(WEB_DIR, 'dist', 'index.html');
  if (!force && existsSync(distIndex)) {
    console.log('[lib] web/dist 已存在，略過 build（加 --build 可強制重建）');
    return;
  }
  await run('npm', ['run', 'build'], { cwd: WEB_DIR });
}

/** 啟動 vite preview（4173，serve web/dist）。 */
export async function startPreview() {
  const proc = spawnBg('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: WEB_DIR,
  });
  await waitForUrl('http://localhost:4173/');
  console.log('[lib] vite preview ready (4173)');
  return proc;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

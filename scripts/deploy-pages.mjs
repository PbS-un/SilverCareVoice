/**
 * scripts/deploy-pages.mjs（T11 交付物）
 *
 * 把 web/dist 構建產物提交到「本地」gh-pages branch（orphan 方式，
 * 可重複執行）。web/dist 被 gitignore，故透過 git worktree 在臨時
 * 目錄操作，不影響主工作區。
 *
 * ⚠️ 本腳本明確【不執行任何 push】。結束後會打印用戶需手動執行的命令。
 *
 * 用法：node scripts/deploy-pages.mjs
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, WEB_DIR, run } from './_lib.mjs';

/** 執行 git 並回傳 { code, out }（不拋錯，供分支存在判斷用）。 */
function git(args, cwd = ROOT) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

function gitOrThrow(args, cwd = ROOT) {
  const { code, out } = git(args, cwd);
  if (code !== 0) throw new Error(`git ${args.join(' ')} 失敗：\n${out}`);
  return out.trim();
}

async function main() {
  console.log('[pages] 1/5 構建 web（npm run build）……');
  await run('npm', ['run', 'build'], { cwd: WEB_DIR });
  const distDir = path.join(WEB_DIR, 'dist');
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('web/dist/index.html 不存在，build 似乎失敗');
  }

  console.log('[pages] 2/5 檢查 git 倉庫與 gh-pages branch……');
  gitOrThrow(['rev-parse', '--git-dir']); // 確認在 git 倉庫內
  const branchExists = git(['show-ref', '--verify', '--quiet', 'refs/heads/gh-pages']).code === 0;

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'silvercare-pages-'));
  console.log(`[pages] 3/5 建立臨時 worktree：${tmp}`);

  try {
    if (branchExists) {
      gitOrThrow(['worktree', 'add', tmp, 'gh-pages']);
    } else {
      // orphan：先以 detach 建 worktree，再 checkout --orphan gh-pages
      gitOrThrow(['worktree', 'add', '--detach', tmp, 'HEAD']);
      gitOrThrow(['checkout', '--orphan', 'gh-pages'], tmp);
      // orphan 會把 HEAD 樹暫存進 index —— 全部移除
      git(['rm', '-rf', '--cached', '.'], tmp);
    }

    // 清空 worktree 內舊檔案（保留 .git）
    for (const entry of readdirSync(tmp)) {
      if (entry === '.git') continue;
      rmSync(path.join(tmp, entry), { recursive: true, force: true });
    }

    // 複製 dist 內容（含 .nojekyll，避免 GitHub Pages 忽略 _ 開頭路徑）
    cpSync(distDir, tmp, { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(tmp, '.nojekyll'), '');

    console.log('[pages] 4/5 提交到本地 gh-pages branch……');
    gitOrThrow(['add', '-A'], tmp);
    const { code: diffCode } = git(['diff', '--cached', '--quiet'], tmp);
    if (diffCode === 0) {
      console.log('[pages] dist 內容與 gh-pages 一致，無需新提交。');
    } else {
      const stamp = new Date().toISOString();
      gitOrThrow(['-c', 'user.name=deploy-pages-script', '-c', 'user.email=deploy-pages@local',
        'commit', '-m', `deploy: web build ${stamp}`], tmp);
      console.log('[pages] 已提交新版本到本地 gh-pages。');
    }
  } finally {
    console.log('[pages] 5/5 清理臨時 worktree……');
    git(['worktree', 'remove', '--force', tmp]);
    rmSync(tmp, { recursive: true, force: true });
    git(['worktree', 'prune']);
  }

  const head = gitOrThrow(['rev-parse', '--short', 'gh-pages']);
  console.log('\n==================== 完成 ====================');
  console.log(`本地 gh-pages branch 已就緒（commit ${head}）。`);
  console.log('本腳本【沒有】執行任何 push／遠端操作。發布請自行執行：\n');
  console.log('  # 1. （首次）設定遠端倉庫');
  console.log('  git remote add origin <你的 GitHub 倉庫 URL>');
  console.log('  # 2. 推送主分支');
  console.log('  git push origin master   # 或 main');
  console.log('  # 3. 推送 gh-pages');
  console.log('  git push origin gh-pages');
  console.log('  # 4. GitHub 倉庫 Settings → Pages → Source 選 gh-pages（或用 repo 內 workflow）');
  console.log('  # 5. 取得公開 URL 後，重生成含真實 QR 的 PDF：');
  console.log('  node scripts/generate-pdf.mjs --url <公開URL>\n');
}

main().catch((err) => {
  console.error('[pages] 失敗：', err.message ?? err);
  process.exit(1);
});

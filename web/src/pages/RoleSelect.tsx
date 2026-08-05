/**
 * 角色選擇頁（路由 '/'）：長者／家人／數據洞察三入口 + Demo Reset。
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { demoReset } from '../data/demoReset';
import SyncBadge from '../components/SyncBadge';

export default function RoleSelect() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState(false);

  const doReset = async (): Promise<void> => {
    setResetting(true);
    try {
      await demoReset();
      setDone(true);
      setConfirming(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium tracking-widest text-[var(--sc-muted)]">
          SILVERCARE MACAU
        </span>
        <SyncBadge />
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <h1 className="font-serif-display text-[2.6rem] font-black leading-tight text-ink">
          銀髮一句通
        </h1>
        <p className="text-elder-body text-[var(--sc-ink-soft)]">
          一句說話，記低健康。請選擇你的身份：
        </p>

        <div className="flex flex-col gap-4">
          <button
            type="button"
            data-testid="role-elder"
            aria-label="我是長者"
            onClick={() => navigate('/elder')}
            className="card-elder group flex items-center gap-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--sc-idle)] text-3xl text-white"
            >
              👵
            </span>
            <span>
              <span className="text-elder-title block">我是長者</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">講句嘢就幫你記低</span>
            </span>
          </button>

          <button
            type="button"
            data-testid="role-family"
            aria-label="我是監護人"
            onClick={() => navigate('/family')}
            className="card-elder group flex items-center gap-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--sc-ok)] text-3xl text-white"
            >
              👨‍👩‍👧
            </span>
            <span>
              <span className="text-elder-title block">我是監護人</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">查看及跟進長者健康情況</span>
            </span>
          </button>

          <button
            type="button"
            data-testid="role-insights"
            aria-label="數據洞察"
            onClick={() => navigate('/insights')}
            className="card-elder group flex items-center gap-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--sc-listening)] text-3xl text-white"
            >
              📊
            </span>
            <span>
              <span className="text-elder-title block">數據洞察</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">整體照護數據總覽</span>
            </span>
          </button>
        </div>

        <p className="text-center text-lg">
          <Link
            to="/report"
            data-testid="link-report"
            className="font-bold text-[var(--sc-idle-deep)] underline underline-offset-4"
          >
            查看可打印總報告
          </Link>
        </p>
      </section>

      <footer className="mt-6 border-t border-[var(--sc-line)] pt-4">
        {done ? (
          <p className="text-center text-lg font-bold text-[var(--sc-ok)]" role="status">
            已重置為示範資料 ✓
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-lg font-bold text-[var(--sc-urgent)]">
              會清除全部記錄並還原示範資料，確定？
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                data-testid="demo-reset-confirm"
                className="btn-elder btn-urgent flex-1"
                onClick={() => void doReset()}
                disabled={resetting}
              >
                {resetting ? '重置緊……' : '確定重置'}
              </button>
              <button
                type="button"
                className="btn-elder btn-ghost flex-1"
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="demo-reset"
            className="btn-elder btn-ghost mx-auto flex"
            onClick={() => setConfirming(true)}
          >
            Demo 重置
          </button>
        )}
      </footer>
    </main>
  );
}

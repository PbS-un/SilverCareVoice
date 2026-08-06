/**
 * 角色選擇頁（路由 '/'）：長者／家人／數據洞察三入口 + Demo Reset。
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { demoReset } from '../data/demoReset';
import SyncBadge from '../components/SyncBadge';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n';
import { clearDemoSession } from '../lib/demoAuth';

export default function RoleSelect() {
  const { t } = useI18n();
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
          {t('role.kicker')}
        </span>
        <span className="flex items-center gap-2">
          <LanguageSelector compact />
          <SyncBadge />
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <h1 className="font-serif-display text-[2.6rem] font-black leading-tight text-ink">
          {t('role.title')}
        </h1>
        <p className="text-elder-body text-[var(--sc-ink-soft)]">{t('role.subtitle')}</p>

        <p
          data-testid="synthetic-notice"
          className="rounded-xl border border-[var(--sc-line)] bg-white/70 px-4 py-3 text-base leading-relaxed text-[var(--sc-muted)]"
        >
          {t('synthetic.notice')}
        </p>

        <div className="flex flex-col gap-4">
          <button
            type="button"
            data-testid="role-elder"
            aria-label={t('role.elder')}
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
              <span className="text-elder-title block">{t('role.elder')}</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">{t('role.elderDesc')}</span>
            </span>
          </button>

          <button
            type="button"
            data-testid="role-family"
            aria-label={t('role.family')}
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
              <span className="text-elder-title block">{t('role.family')}</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">{t('role.familyDesc')}</span>
            </span>
          </button>

          <button
            type="button"
            data-testid="role-insights"
            aria-label={t('role.insights')}
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
              <span className="text-elder-title block">{t('role.insights')}</span>
              <span className="text-lg text-[var(--sc-ink-soft)]">{t('role.insightsDesc')}</span>
            </span>
          </button>
        </div>

        <p className="text-center text-lg">
          <Link
            to="/report"
            data-testid="link-report"
            className="font-bold text-[var(--sc-idle-deep)] underline underline-offset-4"
          >
            {t('role.reportLink')}
          </Link>
        </p>
      </section>

      <footer className="mt-6 border-t border-[var(--sc-line)] pt-4">
        {done ? (
          <p className="text-center text-lg font-bold text-[var(--sc-ok)]" role="status">
            {t('role.resetDone')}
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-lg font-bold text-[var(--sc-urgent)]">
              {t('role.resetConfirm')}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                data-testid="demo-reset-confirm"
                className="btn-elder btn-urgent flex-1"
                onClick={() => void doReset()}
                disabled={resetting}
              >
                {resetting ? t('role.resetting') : t('role.resetConfirmBtn')}
              </button>
              <button
                type="button"
                className="btn-elder btn-ghost flex-1"
                onClick={() => setConfirming(false)}
              >
                {t('role.resetCancel')}
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
            {t('role.reset')}
          </button>
        )}
      </footer>

      <button
        type="button"
        data-testid="logout-button"
        className="mt-3 text-center text-base font-bold text-[var(--sc-muted)] underline underline-offset-4"
        onClick={() => {
          clearDemoSession();
          navigate('/login', { replace: true });
        }}
      >
        {t('role.logout')}
      </button>
    </main>
  );
}

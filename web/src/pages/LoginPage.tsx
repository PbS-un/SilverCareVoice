/**
 * Demo Login 頁（路由 '/login'，T3）
 *
 * 簡潔卡片式登入：品牌、ID、密碼、登入按鈕、語言選擇器、錯誤訊息。
 * 沿用現有 colour／card／typography／spacing，不重新 redesign。
 * 成功後 sessionStorage 記 demoAuthenticated=true，跳去角色選擇（/）。
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n';
import { validateDemoLogin, setDemoAuthenticated } from '../lib/demoAuth';

export default function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!validateDemoLogin(id, password)) {
      setError(t('login.error'));
      return;
    }
    setBusy(true);
    // 同步 sessionStorage 後一定先進 Role Selection（/），唔直接入 /elder
    setDemoAuthenticated(true);
    navigate('/', { replace: true });
  };

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium tracking-widest text-[var(--sc-muted)]">
          {t('login.kicker')}
        </span>
        <LanguageSelector compact />
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-8">
        <div className="text-center">
          <h1 className="font-serif-display text-[2.6rem] font-black leading-tight text-ink">
            {t('login.title')}
          </h1>
          <p className="mt-1 text-elder-body text-[var(--sc-ink-soft)]">{t('login.subtitle')}</p>
        </div>

        <form
          className="card-elder flex flex-col gap-4"
          onSubmit={submit}
          data-testid="demo-login-form"
        >
          <label className="flex flex-col gap-1 text-xl font-bold">
            {t('login.idLabel')}
            <input
              data-testid="demo-login-id"
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
              placeholder={t('login.idPlaceholder')}
              className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xl font-bold">
            {t('login.passwordLabel')}
            <input
              data-testid="demo-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder={t('login.passwordPlaceholder')}
              className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            />
          </label>

          {error && (
            <p role="alert" data-testid="demo-login-error" className="text-xl text-[var(--sc-urgent)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="demo-login-submit"
            className="btn-elder btn-primary w-full !min-h-14 text-2xl"
            disabled={busy}
          >
            {busy ? t('login.submitting') : t('login.button')}
          </button>

          <p className="text-center text-base text-[var(--sc-muted)]">{t('login.demoHint')}</p>
        </form>
      </section>

      <footer className="mt-6 border-t border-[var(--sc-line)] pt-4 text-center text-base text-[var(--sc-muted)]">
        {t('login.footer')}
      </footer>
    </main>
  );
}

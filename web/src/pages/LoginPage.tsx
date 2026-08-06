/**
 * Demo Login 頁（路由 '/login'，T3）
 *
 * 100 名合成長者選擇：dropdown 揀一位長者 → 帳號（demo-xxx）與密碼
 * （SCV-Demo!2026-xxx-Macau，deterministic）自動填入 → 一鍵登入。
 * 舊 tester/tester 已移除（validateDemoCredentials 必然拒絕）。
 * 成功後 sessionStorage 保存 account→elder→guardian 綁定，跳去角色選擇（/）。
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import LanguageSelector from '../components/LanguageSelector';
import { demoReset } from '../data/demoReset';
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { CaregiverLink, ElderProfile, User } from '../types/entities';
import { useI18n } from '../i18n';
import {
  demoPasswordFor,
  setDemoSession,
  validateDemoCredentials,
} from '../lib/demoAuth';

interface DemoOption {
  elderId: string;
  elderName: string;
  age: number;
  accountCode: string;
  accountId: string;
  caregiverId: string;
}

export default function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [options, setOptions] = useState<DemoOption[]>([]);
  const [selected, setSelected] = useState<DemoOption | null>(null);
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reseedBusy, setReseedBusy] = useState(false);

  const loadOptions = async (): Promise<void> => {
    const provider = getProvider();
    const [elders, users, links] = await Promise.all([
      provider.list<ElderProfile>(tableNameOf('ElderProfile')),
      provider.list<User>(tableNameOf('User')),
      provider.list<CaregiverLink>(tableNameOf('CaregiverLink')),
    ]);
    const elderUsers = users.filter((u) => u.role === 'elder' && u.accountCode);
    const linkByElder = new Map(links.map((l) => [l.elderId, l.caregiverId]));
    const opts: DemoOption[] = elders
      .map((e) => {
        const account = elderUsers.find((u) => u.refId === e.id);
        if (!account?.accountCode) return null;
        return {
          elderId: e.id,
          elderName: e.name,
          age: e.age,
          accountCode: account.accountCode,
          accountId: account.id,
          caregiverId: linkByElder.get(e.id) ?? '',
        };
      })
      .filter((o): o is DemoOption => o !== null && o.caregiverId !== '')
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    setOptions(opts);
  };

  // 由 DB 讀取 100 名合成長者與對應 account／guardian（App 啟動已完成 seed）
  useEffect(() => {
    let live = true;
    loadOptions()
      .catch(() => {
        /* 載入失敗留空，由 UI 呈現空態 */
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 空態兜底：舊版/雲端舊資料冇 demo account 時，一鍵重灌 100 名合成長者。 */
  const reseed = async (): Promise<void> => {
    setReseedBusy(true);
    try {
      await demoReset();
      await loadOptions();
    } finally {
      setReseedBusy(false);
    }
  };

  const onSelect = (elderId: string): void => {
    const opt = options.find((o) => o.elderId === elderId) ?? null;
    setSelected(opt);
    setError('');
    if (opt) {
      setId(opt.accountCode);
      setPassword(demoPasswordFor(opt.accountCode));
    } else {
      setId('');
      setPassword('');
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!selected) {
      setError(t('login.selectorPlaceholder'));
      return;
    }
    if (!validateDemoCredentials(selected.accountCode, id, password)) {
      setError(t('login.error'));
      return;
    }
    setBusy(true);
    setDemoSession({
      accountCode: selected.accountCode,
      accountId: selected.accountId,
      elderId: selected.elderId,
      caregiverId: selected.caregiverId,
      elderName: selected.elderName,
    });
    // 一定先進 Role Selection（/），唔直接入 /elder
    navigate('/', { replace: true });
  };

  const optionsMemo = useMemo(() => options, [options]);

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
            {t('login.selectorLabel')}
            <select
              data-testid="demo-elder-select"
              value={selected?.elderId ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] bg-white px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            >
              <option value="">{t('login.selectorPlaceholder')}</option>
              {optionsMemo.map((o) => (
                <option key={o.elderId} value={o.elderId}>
                  {o.elderName}，{o.age}歲
                </option>
              ))}
            </select>
          </label>
          <p className="text-base text-[var(--sc-muted)]">{t('login.selectorHelp')}</p>

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

          <p className="text-center text-base font-bold text-[var(--sc-idle-deep)]">
            {t('login.notice')}
          </p>
        </form>

        {loaded && options.length === 0 && (
          <div className="card-elder flex flex-col gap-3">
            <p data-testid="login-no-demo-data" className="text-xl text-[var(--sc-thinking)]">
              {t('login.noDemoData')}
            </p>
            <button
              type="button"
              data-testid="login-reseed"
              className="btn-elder btn-primary w-full"
              onClick={() => void reseed()}
              disabled={reseedBusy}
            >
              {reseedBusy ? t('login.submitting') : t('login.reseed')}
            </button>
          </div>
        )}
      </section>

      <footer className="mt-6 border-t border-[var(--sc-line)] pt-4 text-center text-base text-[var(--sc-muted)]">
        {t('login.footer')}
      </footer>
    </main>
  );
}

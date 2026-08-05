/**
 * 首次進入同意畫面（doc 05 風格免責）：
 * localStorage 標記 + Consent 表雙重檢查；同意後寫 Consent + AuditLog。
 */
import { useEffect, useState, type ReactNode } from 'react';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { AuditLog, Consent, ElderProfile } from '../types/entities';
import { useI18n } from '../i18n';

const CONSENT_STORAGE_KEY = 'scv.consent.v1';
const CONSENT_TYPE = 'usage_consent';

const CONSENT_TEXT =
  '本系統提供健康資訊與提醒，不是醫療診斷。所有健康記錄儲存於此裝置（如開啟同步，會與家人授權的裝置共享）。如有不適，請聯絡家人或醫生；情況緊急請致電 999。';

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 已有同意標記（localStorage 或 Consent 表）？ */
async function hasConsent(): Promise<boolean> {
  try {
    if (localStorage.getItem(CONSENT_STORAGE_KEY) === '1') return true;
  } catch {
    /* 私隱模式等環境忽略 */
  }
  const consents = await getProvider().list<Consent>(tableNameOf('Consent'));
  return consents.some((c) => c.type === CONSENT_TYPE && c.granted);
}

/** 寫入同意記錄（Consent + AuditLog）。 */
async function persistConsent(): Promise<void> {
  const provider = getProvider();
  const elders = await provider.list<ElderProfile>(tableNameOf('ElderProfile'));
  const elderId = elders[0]?.id ?? 'unknown';
  const t = new Date().toISOString();

  const consent: Consent = {
    id: newId(),
    elderId,
    type: CONSENT_TYPE,
    granted: true,
    text: CONSENT_TEXT,
    createdAt: t,
    updatedAt: t,
  };
  const saved = await provider.put<Consent>(tableNameOf('Consent'), consent);

  const audit: AuditLog = {
    id: newId(),
    actor: elderId,
    action: 'consent.grant',
    entityType: 'Consent',
    entityId: saved.id,
    detail: CONSENT_TYPE,
    createdAt: t,
    updatedAt: t,
  };
  await provider.put<AuditLog>(tableNameOf('AuditLog'), audit);

  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  } catch {
    /* 寫唔到 localStorage 唔影響流程 */
  }
}

/** 包裹需要同意先決嘅路由（老人端／家屬端）。 */
export default function RequireConsent({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<'checking' | 'needed' | 'granted'>('checking');
  const [agreeing, setAgreeing] = useState(false);

  useEffect(() => {
    let live = true;
    hasConsent()
      .then((ok) => {
        if (live) setState(ok ? 'granted' : 'needed');
      })
      .catch(() => {
        if (live) setState('needed');
      });
    return () => {
      live = false;
    };
  }, []);

  const agree = async (): Promise<void> => {
    setAgreeing(true);
    try {
      await persistConsent();
      setState('granted');
    } finally {
      setAgreeing(false);
    }
  };

  if (state === 'granted') return <>{children}</>;

  if (state === 'checking') {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
          {t('consent.checking')}
        </p>
      </main>
    );
  }

  return (
    <main
      data-testid="consent-screen"
      className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-5 py-10"
    >
      <div className="card-elder flex flex-col gap-5">
        <h1 className="text-elder-title font-serif-display">{t('consent.title')}</h1>
        <p className="text-elder-body leading-relaxed">{t('consent.text')}</p>
        <ul className="list-disc space-y-2 pl-6 text-lg text-[var(--sc-ink-soft)]">
          <li>{t('consent.bullet1')}</li>
          <li>{t('consent.bullet2')}</li>
          <li>{t('consent.bullet3')}</li>
        </ul>
        <button
          type="button"
          data-testid="consent-agree"
          className="btn-elder btn-primary w-full"
          onClick={() => void agree()}
          disabled={agreeing}
        >
          {agreeing ? t('consent.agreeing') : t('consent.agree')}
        </button>
      </div>
    </main>
  );
}

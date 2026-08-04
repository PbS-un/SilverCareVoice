/**
 * 家屬提醒（路由 '/family/alerts'）：
 * Alert 列表（severity 顏色、open/acknowledged/resolved 狀態）→
 * [已跟進] 彈窗（type + 備註）→ 寫 CaregiverFollowUp + Alert resolved，
 * Timeline 即時出現跟進紀錄（subscribe 自動刷新）。
 */
import { useState } from 'react';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { Alert } from '../types/entities';
import { acknowledgeAlert, followUpAlert } from '../services/AlertService';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { fmtDate, FOLLOWUP_TYPE_LABELS, SEVERITY_LABELS } from '../lib/format';
import BottomNav, { FAMILY_NAV_ITEMS } from '../components/BottomNav';
import Modal from '../components/Modal';

const SEVERITY_BORDER: Record<Alert['severity'], string> = {
  urgent: 'border-l-[var(--sc-urgent)]',
  attention: 'border-l-[var(--sc-thinking)]',
  normal: 'border-l-[var(--sc-muted)]',
};

const STATUS_LABEL: Record<Alert['status'], string> = {
  open: '未處理',
  acknowledged: '知道了',
  resolved: '已跟進',
};

export default function FamilyAlerts() {
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';
  const [followUpAlertId, setFollowUpAlertId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const { data: alerts } = useAsyncData(async () => {
    if (!elderId) return [];
    const rows = await getProvider().list<Alert>(tableNameOf('Alert'), { elderId });
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [dbVersion, elderId]);

  const ack = async (alert: Alert): Promise<void> => {
    try {
      await acknowledgeAlert(alert.id, alert.caregiverId);
    } catch {
      /* 權限／不存在：保持現狀 */
    }
  };

  if (!ctx) return null;

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      <h1 className="mb-5 font-serif-display text-elder-display text-ink">提醒</h1>

      {toast && (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xl font-bold text-[var(--sc-ok)]">
          {toast}
        </p>
      )}

      <ul className="flex flex-col gap-4" aria-label="提醒列表">
        {(alerts ?? []).map((a) => (
          <li
            key={a.id}
            data-testid="family-alert-item"
            className={`card-elder border-l-8 ${SEVERITY_BORDER[a.severity]} ${
              a.status === 'resolved' ? 'opacity-70' : ''
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-0.5 text-base font-bold text-white ${
                  a.severity === 'urgent'
                    ? 'bg-[var(--sc-urgent)]'
                    : a.severity === 'attention'
                      ? 'bg-[var(--sc-thinking)]'
                      : 'bg-[var(--sc-muted)]'
                }`}
              >
                {SEVERITY_LABELS[a.severity]}
              </span>
              <span className="text-base text-[var(--sc-muted)]">{fmtDate(a.createdAt)}</span>
              <span className="ml-auto text-base font-bold text-[var(--sc-ink-soft)]">
                {STATUS_LABEL[a.status]}
              </span>
            </div>
            <p className="text-xl leading-relaxed">{a.message}</p>
            {a.status !== 'resolved' && (
              <div className="mt-3 flex gap-3">
                {a.status === 'open' && (
                  <button
                    type="button"
                    data-testid="acknowledge-button"
                    className="btn-elder btn-ghost flex-1 !px-3 text-xl"
                    onClick={() => void ack(a)}
                  >
                    知道了
                  </button>
                )}
                <button
                  type="button"
                  data-testid="followup-button"
                  className="btn-elder btn-primary flex-1 !px-3 text-xl"
                  onClick={() => setFollowUpAlertId(a.id)}
                >
                  已跟進
                </button>
              </div>
            )}
          </li>
        ))}
        {(alerts ?? []).length === 0 && (
          <li className="text-xl text-[var(--sc-muted)]">而家冇提醒。</li>
        )}
      </ul>

      {followUpAlertId && (
        <FollowUpModal
          alert={(alerts ?? []).find((a) => a.id === followUpAlertId) ?? null}
          onClose={() => setFollowUpAlertId(null)}
          onDone={() => {
            setFollowUpAlertId(null);
            setToast('已記低跟進 ✓');
          }}
        />
      )}

      <BottomNav items={FAMILY_NAV_ITEMS} />
    </main>
  );
}

function FollowUpModal({
  alert,
  onClose,
  onDone,
}: {
  alert: Alert | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<'phone' | 'message' | 'visit' | 'other'>('phone');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (): Promise<void> => {
    if (!alert) return;
    setBusy(true);
    setErr('');
    try {
      await followUpAlert(alert.id, alert.caregiverId, type, note.trim());
      onDone();
    } catch {
      setErr('跟進記錄未能儲存，請再試一次。');
    } finally {
      setBusy(false);
    }
  };

  if (!alert) return null;

  return (
    <Modal title="記錄跟進" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xl text-[var(--sc-ink-soft)]">{alert.message}</p>
        <fieldset>
          <legend className="mb-2 text-xl font-bold">跟進方式</legend>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(FOLLOWUP_TYPE_LABELS) as Array<keyof typeof FOLLOWUP_TYPE_LABELS>).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`followup-type-${t}`}
                  aria-pressed={type === t}
                  onClick={() => setType(t)}
                  className={`btn-elder !min-h-12 !px-2 text-lg ${
                    type === t ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {FOLLOWUP_TYPE_LABELS[t]}
                </button>
              ),
            )}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xl font-bold">
          備註（可留空）
          <textarea
            data-testid="followup-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="rounded-xl border-2 border-[var(--sc-line)] px-4 py-2 text-xl outline-none focus:border-[var(--sc-idle)]"
          />
        </label>
        {err && <p role="alert" className="text-xl text-[var(--sc-urgent)]">{err}</p>}
        <button
          type="button"
          data-testid="followup-submit"
          className="btn-elder btn-primary w-full"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? '記低緊……' : '確認已跟進'}
        </button>
      </div>
    </Modal>
  );
}

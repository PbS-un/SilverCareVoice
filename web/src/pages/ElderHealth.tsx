/**
 * 老人端「我的記錄」（路由 '/elder/health'）：
 * 血壓／血糖／心率／體重列表 + 手動新增 + 最近趨勢小圖（Recharts）
 * + 覆診 Appointment 列表與新增。全部 DB 實算、subscribe 刷新。
 */
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { Appointment, VitalRecord, VitalType } from '../types/entities';
import { recordBloodPressure, recordSingleVital } from '../lib/manualEntry';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { fmtAppointmentDate, fmtDate, fmtShortDate } from '../lib/format';
import { useI18n } from '../i18n';
import BottomNav, { ELDER_NAV_ITEMS } from '../components/BottomNav';
import AppointmentModal from '../components/modals/AppointmentModal';

const TYPES: VitalType[] = ['blood_pressure', 'blood_glucose', 'heart_rate', 'weight'];

export default function ElderHealth() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';
  const [type, setType] = useState<VitalType>('blood_pressure');
  const [toast, setToast] = useState('');
  const [apptOpen, setApptOpen] = useState(false);

  const { data: vitals } = useAsyncData(async () => {
    if (!elderId) return [];
    const rows = await getProvider().list<VitalRecord>(tableNameOf('VitalRecord'), { elderId });
    return rows
      .filter((v) => v.type === type)
      .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  }, [dbVersion, elderId, type]);

  const { data: appointments } = useAsyncData(async () => {
    if (!elderId) return [];
    const rows = await getProvider().list<Appointment>(tableNameOf('Appointment'), { elderId });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [dbVersion, elderId]);

  const chartData = [...(vitals ?? [])]
    .reverse()
    .slice(-14)
    .map((v) => ({
      day: fmtShortDate(v.measuredAt),
      ...(type === 'blood_pressure'
        ? { value: v.systolic, value2: v.diastolic }
        : { value: v.value }),
    }));

  if (!ctx) return null;

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      <h1 className="mb-5 font-serif-display text-elder-display text-ink">{t('elderHealth.title')}</h1>

      {/* 類型切換 */}
      <div role="tablist" aria-label={t('elderHealth.tabsAria')} className="mb-5 grid grid-cols-4 gap-2">
        {TYPES.map((vt) => (
          <button
            key={vt}
            type="button"
            role="tab"
            aria-selected={type === vt}
            onClick={() => setType(vt)}
            className={`btn-elder !min-h-12 !px-2 text-lg ${
              type === vt ? 'btn-primary' : 'btn-ghost'
            }`}
          >
            {t(`vital.${vt}`)}
          </button>
        ))}
      </div>

      {/* 趨勢小圖 */}
      <section className="card-elder mb-5" aria-label={t('elderHealth.trendAria', { label: t(`vital.${type}`) })}>
        <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('elderHealth.trend')}</h2>
        {chartData.length === 0 ? (
          <p className="text-xl text-[var(--sc-muted)]">{t('elderHealth.noRecords')}</p>
        ) : (
          <div data-testid="elder-vital-chart" className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                <XAxis dataKey="day" tick={{ fontSize: 14 }} />
                <YAxis tick={{ fontSize: 14 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={type === 'blood_pressure' ? t('vital.systolicShort') : t(`vital.${type}`)}
                  stroke="var(--sc-idle)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                />
                {type === 'blood_pressure' && (
                  <Line
                    type="monotone"
                    dataKey="value2"
                    name={t('vital.diastolicShort')}
                    stroke="var(--sc-ok)"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 手動新增 */}
      <VitalAddForm
        elderId={elderId}
        type={type}
        onDone={(msg) => setToast(msg)}
      />

      {toast && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-xl font-bold text-[var(--sc-ok)]">
          {toast}
        </p>
      )}

      {/* 記錄列表 */}
      <section aria-label={t('elderHealth.recordsAria')} className="mt-5">
        <h2 className="mb-3 text-elder-title font-serif-display">{t('elderHealth.records')}</h2>
        <ul data-testid="vital-list" className="flex flex-col gap-2">
          {(vitals ?? []).slice(0, 15).map((v) => (
            <li key={v.id} className="card-elder flex items-center justify-between !py-3">
              <span className="text-elder-body font-bold">
                {v.type === 'blood_pressure'
                  ? `${v.systolic}/${v.diastolic} mmHg`
                  : `${v.value} ${v.unit}`}
              </span>
              <span className="text-lg text-[var(--sc-ink-soft)]">{fmtDate(v.measuredAt)}</span>
            </li>
          ))}
          {(vitals ?? []).length === 0 && (
            <li className="text-xl text-[var(--sc-muted)]">{t('elderHealth.noRecordsHint')}</li>
          )}
        </ul>
      </section>

      {/* 覆診 */}
      <section aria-label={t('elderHealth.appointmentsAria')} className="mt-8">
        <h2 className="mb-3 text-elder-title font-serif-display">{t('elderHealth.appointments')}</h2>
        <ul data-testid="appointment-list" className="mb-4 flex flex-col gap-2">
          {(appointments ?? []).map((a) => (
            <li key={a.id} className="card-elder !py-3">
              <p className="text-xl font-bold">
                {fmtAppointmentDate(a)} · {a.location}
              </p>
              {(a.specialty || a.doctor) && (
                <p className="text-lg text-[var(--sc-ink-soft)]">
                  {[a.specialty, a.doctor].filter(Boolean).join(' · ')}
                </p>
              )}
              {a.note && <p className="text-lg text-[var(--sc-ink-soft)]">{a.note}</p>}
            </li>
          ))}
          {(appointments ?? []).length === 0 && (
            <li className="text-xl text-[var(--sc-muted)]">{t('elderHealth.noAppointments')}</li>
          )}
        </ul>
        <button
          type="button"
          data-testid="appt-add-open"
          onClick={() => setApptOpen(true)}
          className="btn-elder btn-primary w-full"
        >
          {t('elderHealth.addAppointment')}
        </button>
      </section>

      {apptOpen && (
        <AppointmentModal
          elderId={elderId}
          appointments={appointments ?? []}
          onClose={() => setApptOpen(false)}
          onDone={() => setToast(t('elderHealth.savedAppointment'))}
        />
      )}

      <BottomNav items={ELDER_NAV_ITEMS} />
    </main>
  );
}

/* ==================== 表單 ==================== */

function VitalAddForm({
  elderId,
  type,
  onDone,
}: {
  elderId: string;
  type: VitalType;
  onDone: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (): Promise<void> => {
    const na = Number(a);
    const nb = Number(b);
    if (!na || (type === 'blood_pressure' && !nb)) {
      setErr(t('elderHealth.enterNumber'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      if (type === 'blood_pressure') {
        await recordBloodPressure(elderId, na, nb);
      } else {
        await recordSingleVital(elderId, type, na);
      }
      setA('');
      setB('');
      onDone(t('elderHealth.savedVital', { label: t(`vital.${type}`) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card-elder flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-xl font-bold text-[var(--sc-ink-soft)]">
        {t('elderHealth.addVital', { label: t(`vital.${type}`) })}
      </h2>
      <div className="flex gap-3">
        <input
          type="number"
          inputMode="decimal"
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder={type === 'blood_pressure' ? t('vital.systolicShort') : t('vital.value')}
          aria-label={type === 'blood_pressure' ? t('vital.systolic') : t(`vital.${type}`)}
          className="min-h-14 w-full rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
        />
        {type === 'blood_pressure' && (
          <input
            type="number"
            inputMode="decimal"
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder={t('vital.diastolicShort')}
            aria-label={t('vital.diastolic')}
            className="min-h-14 w-full rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
          />
        )}
      </div>
      {err && <p role="alert" className="text-xl text-[var(--sc-urgent)]">{err}</p>}
      <button type="submit" className="btn-elder btn-primary w-full" disabled={busy}>
        {busy ? t('bp.saving') : t('bp.save')}
      </button>
    </form>
  );
}

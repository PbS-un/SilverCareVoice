/**
 * 家屬健康趨勢（路由 '/family/health'）：
 * 血壓雙線圖（收縮壓／舒張壓 + 參考帶）+ 血糖圖，7 日／30 日切換，
 * vitalsBetween 真實查詢；下方 Timeline 合併六張表按時間排序（全部 DB 實算）。
 */
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  Appointment,
  Caregiver,
  CaregiverFollowUp,
  HealthEvent,
  Medication,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../types/entities';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { fmtDate, fmtShortDate } from '../lib/format';
import { useI18n } from '../i18n';
import BottomNav, { FAMILY_NAV_ITEMS } from '../components/BottomNav';

type RangeDays = 7 | 30;

interface TimelineEntry {
  at: string;
  title: string;
  detail?: string;
  tone: 'idle' | 'ok' | 'attention' | 'urgent' | 'muted';
}

const TONE_DOT: Record<TimelineEntry['tone'], string> = {
  idle: 'bg-[var(--sc-idle)]',
  ok: 'bg-[var(--sc-ok)]',
  attention: 'bg-[var(--sc-thinking)]',
  urgent: 'bg-[var(--sc-urgent)]',
  muted: 'bg-[var(--sc-muted)]',
};

export default function FamilyHealth() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';
  const [days, setDays] = useState<RangeDays>(7);

  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const to = new Date().toISOString();

  const { data: bp } = useAsyncData(
    () => (elderId ? getProvider().vitalsBetween(elderId, 'blood_pressure', from, to) : Promise.resolve([])),
    [dbVersion, elderId, days],
  );
  const { data: glucose } = useAsyncData(
    () => (elderId ? getProvider().vitalsBetween(elderId, 'blood_glucose', from, to) : Promise.resolve([])),
    [dbVersion, elderId, days],
  );

  const { data: timeline } = useAsyncData(async (): Promise<TimelineEntry[]> => {
    if (!elderId) return [];
    const provider = getProvider();
    const [vitals, symptoms, logs, meds, appointments, events, followUps, caregivers] =
      await Promise.all([
        provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId }),
        provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), { elderId }),
        provider.list<MedicationLog>(tableNameOf('MedicationLog'), { elderId }),
        provider.list<Medication>(tableNameOf('Medication'), { elderId }),
        provider.list<Appointment>(tableNameOf('Appointment'), { elderId }),
        provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId }),
        provider.list<CaregiverFollowUp>(tableNameOf('CaregiverFollowUp')),
        provider.list<Caregiver>(tableNameOf('Caregiver')),
      ]);

    const medName = (id: string): string => meds.find((m) => m.id === id)?.name ?? t('common.medication');
    const caregiverName = (id: string): string => caregivers.find((c) => c.id === id)?.name ?? t('common.family');

    const entries: TimelineEntry[] = [
      ...vitals.map<TimelineEntry>((v) => ({
        at: v.measuredAt,
        title: `${t(`vital.${v.type}`)} ${
          v.type === 'blood_pressure' ? `${v.systolic}/${v.diastolic} mmHg` : `${v.value} ${v.unit}`
        }`,
        detail: t('familyHealth.source', {
          source:
            v.source === 'voice'
              ? t('source.voice')
              : v.source === 'text'
                ? t('source.text')
                : v.source === 'form'
                  ? t('source.form')
                  : t('source.seed'),
        }),
        tone: 'idle',
      })),
      ...symptoms.map<TimelineEntry>((s) => ({
        at: s.occurredAt,
        title: t('familyHealth.symptom', { symptoms: s.symptoms.join('、') }),
        detail: s.description || undefined,
        tone: s.severity === 'severe' ? 'urgent' : s.severity === 'moderate' ? 'attention' : 'muted',
      })),
      ...logs.map<TimelineEntry>((l) => ({
        at: l.takenAt ?? l.scheduledAt,
        title: `${medName(l.medicationId)} · ${t(`medStatus.${l.status}`)}`,
        tone: l.status === 'taken' ? 'ok' : l.status === 'missed' ? 'urgent' : 'attention',
      })),
      ...appointments.map<TimelineEntry>((a) => ({
        at: a.date,
        title: t('familyHealth.appointment', { location: a.location }),
        detail: a.note || undefined,
        tone: 'muted',
      })),
      ...events.map<TimelineEntry>((e) => ({
        at: e.createdAt,
        title: t('familyHealth.event', { severity: t(`severity.${e.severity}`) }),
        detail: e.summary,
        tone: e.severity === 'urgent' ? 'urgent' : e.severity === 'attention' ? 'attention' : 'ok',
      })),
      ...followUps.map<TimelineEntry>((f) => ({
        at: f.createdAt,
        title: t('familyHealth.followedUp', { name: caregiverName(f.caregiverId) }),
        detail: f.note || undefined,
        tone: 'ok',
      })),
    ];
    return entries
      .filter((e) => e.at >= from && e.at <= to)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [dbVersion, elderId, days]);

  const bpData = (bp ?? []).map((v) => ({
    day: fmtShortDate(v.measuredAt),
    systolic: v.systolic,
    diastolic: v.diastolic,
  }));
  const glucoseData = (glucose ?? [])
    .filter((v) => v.value !== undefined)
    .map((v) => ({ day: fmtShortDate(v.measuredAt), value: v.value }));

  if (!ctx) return null;

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      <h1 className="mb-5 font-serif-display text-elder-display text-ink">{t('familyHealth.title')}</h1>

      {/* 7 / 30 日切換 */}
      <div role="tablist" aria-label={t('familyHealth.rangeAria')} className="mb-5 grid grid-cols-2 gap-2">
        {([7, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={days === d}
            data-testid={d === 7 ? 'range-7d' : 'range-30d'}
            onClick={() => setDays(d)}
            className={`btn-elder ${days === d ? 'btn-primary' : 'btn-ghost'}`}
          >
            {t('familyHealth.recent', { d })}
          </button>
        ))}
      </div>

      {/* 血壓圖 */}
      <section className="card-elder mb-5" aria-label={t('familyHealth.bpChartAria')}>
        <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('familyHealth.bpChart')}</h2>
        {bpData.length === 0 ? (
          <p className="text-xl text-[var(--sc-muted)]">{t('familyHealth.bpNone')}</p>
        ) : (
          <div data-testid="bp-chart" className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bpData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                <XAxis dataKey="day" tick={{ fontSize: 13 }} />
                {/* 下限 50；上限動態：至少 200，急症高位（如 220+）都完整可見 */}
                <YAxis
                  tick={{ fontSize: 13 }}
                  domain={[50, (dataMax: number) => Math.max(200, dataMax + 10)]}
                />
                {/* 參考帶：一般血壓範圍 */}
                <ReferenceArea y1={90} y2={140} fill="var(--sc-ok)" fillOpacity={0.08} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="systolic"
                  name={t('vital.systolic')}
                  stroke="var(--sc-idle)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="diastolic"
                  name={t('vital.diastolic')}
                  stroke="var(--sc-ok)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 血糖圖 */}
      <section className="card-elder mb-6" aria-label={t('familyHealth.glucoseChartAria')}>
        <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('familyHealth.glucoseChart')}</h2>
        {glucoseData.length === 0 ? (
          <p className="text-xl text-[var(--sc-muted)]">{t('familyHealth.glucoseNone')}</p>
        ) : (
          <div data-testid="glucose-chart" className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={glucoseData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                <XAxis dataKey="day" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 13 }} domain={['auto', 'auto']} />
                <ReferenceArea y1={4} y2={10} fill="var(--sc-ok)" fillOpacity={0.08} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={t('vital.blood_glucose')}
                  stroke="var(--sc-thinking)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Timeline */}
      <section aria-label={t('familyHealth.timelineAria')}>
        <h2 className="mb-4 text-elder-title font-serif-display">{t('familyHealth.timeline')}</h2>
        <ol data-testid="timeline" className="relative flex flex-col gap-4 border-l-2 border-[var(--sc-line)] pl-5">
          {(timeline ?? []).slice(0, 60).map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[1.7rem] top-1.5 h-3.5 w-3.5 rounded-full ${TONE_DOT[e.tone]}`}
              />
              <p className="text-sm font-medium text-[var(--sc-muted)]">{fmtDate(e.at)}</p>
              <p className="text-xl font-bold leading-snug">{e.title}</p>
              {e.detail && <p className="text-lg leading-snug text-[var(--sc-ink-soft)]">{e.detail}</p>}
            </li>
          ))}
          {(timeline ?? []).length === 0 && (
            <li className="text-xl text-[var(--sc-muted)]">{t('familyHealth.timelineNone')}</li>
          )}
        </ol>
      </section>

      <BottomNav items={FAMILY_NAV_ITEMS} />
    </main>
  );
}

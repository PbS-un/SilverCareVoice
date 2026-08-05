/**
 * 家屬首頁（路由 '/family'）：「媽媽今天」摘要卡 ——
 * 今日血壓（最新一筆）、服藥狀態、今日症狀、覆診日期、需要注意事件數。
 * 全部 DB 實算；subscribe 自動更新（sync 模式下另一裝置寫入即時反映）。
 */
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  Alert,
  Appointment,
  HealthEvent,
  Medication,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../types/entities';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { fmtAppointmentDate, fmtTime, isToday } from '../lib/format';
import { useI18n } from '../i18n';
import BottomNav, { FAMILY_NAV_ITEMS } from '../components/BottomNav';
import SyncBadge from '../components/SyncBadge';

interface TodaySummary {
  latestBp?: VitalRecord;
  todayLogs: Array<MedicationLog & { medName: string }>;
  todaySymptoms: SymptomRecord[];
  nextAppointment?: Appointment;
  attentionCount: number;
  openAlerts: Alert[];
}

/** 本地時區日期鍵（YYYY-MM-DD）：timeTbd 預約日期級比較用，避免 UTC 切片時區偏差。 */
const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function FamilyHome() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';

  const { data: summary } = useAsyncData(async (): Promise<TodaySummary | null> => {
    if (!elderId) return null;
    const provider = getProvider();
    const [vitals, logs, meds, symptoms, appointments, events, alerts] = await Promise.all([
      provider.list<VitalRecord>(tableNameOf('VitalRecord'), { elderId }),
      provider.list<MedicationLog>(tableNameOf('MedicationLog'), { elderId }),
      provider.list<Medication>(tableNameOf('Medication'), { elderId }),
      provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), { elderId }),
      provider.list<Appointment>(tableNameOf('Appointment'), { elderId }),
      provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId }),
      provider.list<Alert>(tableNameOf('Alert'), { elderId }),
    ]);

    const bpToday = vitals
      .filter((v) => v.type === 'blood_pressure' && isToday(v.measuredAt))
      .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
    const medNameOf = (id: string): string => meds.find((m) => m.id === id)?.name ?? t('common.medication');

    return {
      latestBp: bpToday[0],
      todayLogs: logs
        .filter((l) => isToday(l.scheduledAt) || (l.takenAt ? isToday(l.takenAt) : false))
        .map((l) => ({ ...l, medName: medNameOf(l.medicationId) })),
      todaySymptoms: symptoms.filter((s) => isToday(s.occurredAt)),
      // 過濾語義（與 AssistantService.buildAppointmentAnswer 一致）：
      // - timeTbd 預約以當日本地午夜存儲 → 用本地日期鍵（YYYY-MM-DD）比較，
      //   避免 UTC 字串切片喺 UTC+8 當日 08:00 後把 timeTbd 當日預約誤判為已過；
      // - 有時間嘅預約保留完整時間戳比較（當日已過嘅舊預約應隱藏）。
      nextAppointment: appointments
        .filter((a) =>
          a.timeTbd
            ? localDateKey(new Date(a.date)) >= localDateKey(new Date())
            : a.date >= new Date().toISOString(),
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0],
      attentionCount: events.filter(
        (e) => e.severity !== 'normal' && isToday(e.createdAt),
      ).length,
      openAlerts: alerts.filter((a) => a.status !== 'resolved'),
    };
  }, [dbVersion, elderId]);

  if (!ctx) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
          {t('common.loading')}
        </p>
      </main>
    );
  }

  const s = summary;

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-sm font-medium tracking-widest text-[var(--sc-muted)]">{t('familyHome.kicker')}</p>
          <h1 className="font-serif-display text-elder-display text-ink">
            {t('familyHome.todayTitle', { name: ctx.elderName })}
          </h1>
        </div>
        <SyncBadge />
      </header>

      {!s ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          {t('familyHome.computing')}
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="family-today-summary">
          {/* 今日血壓 */}
          <section className="card-elder" aria-label={t('familyHome.bp')}>
            <h2 className="mb-1 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyHome.bp')}</h2>
            {s.latestBp ? (
              <p className="text-elder-title">
                {s.latestBp.systolic}/{s.latestBp.diastolic}
                <span className="ml-1 text-xl text-[var(--sc-ink-soft)]">mmHg</span>
                <span className="ml-3 text-lg font-normal text-[var(--sc-muted)]">
                  {fmtTime(s.latestBp.measuredAt)}
                </span>
              </p>
            ) : (
              <p className="text-elder-body text-[var(--sc-muted)]">{t('familyHome.bpNone')}</p>
            )}
          </section>

          {/* 服藥狀態 */}
          <section className="card-elder" aria-label={t('familyHome.meds')}>
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyHome.meds')}</h2>
            {s.todayLogs.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">{t('familyHome.medsNone')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.todayLogs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between text-xl">
                    <span>{l.medName}</span>
                    <span
                      className={`rounded-full px-3 py-0.5 text-base font-bold ${
                        l.status === 'taken'
                          ? 'bg-emerald-50 text-[var(--sc-ok)]'
                          : l.status === 'missed'
                            ? 'bg-red-50 text-[var(--sc-urgent)]'
                            : 'bg-amber-50 text-[var(--sc-thinking)]'
                      }`}
                    >
                      {t(`medStatus.${l.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 今日症狀 */}
          <section className="card-elder" aria-label={t('familyHome.symptoms')}>
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyHome.symptoms')}</h2>
            {s.todaySymptoms.length === 0 ? (
              <p className="text-xl text-[var(--sc-ok)] font-bold">{t('familyHome.symptomsNone')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.todaySymptoms.map((r) => (
                  <li key={r.id} className="text-xl">
                    <span className="font-bold">{r.symptoms.join('、')}</span>
                    {r.description && (
                      <span className="text-[var(--sc-ink-soft)]"> — {r.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 覆診 */}
          <section className="card-elder" aria-label={t('familyHome.appointment')}>
            <h2 className="mb-1 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyHome.appointment')}</h2>
            {s.nextAppointment ? (
              <p className="text-elder-body font-bold">
                {fmtAppointmentDate(s.nextAppointment)} · {s.nextAppointment.location}
              </p>
            ) : (
              <p className="text-xl text-[var(--sc-muted)]">{t('familyHome.appointmentNone')}</p>
            )}
          </section>

          {/* 需要注意 */}
          <section
            className={`card-elder ${s.attentionCount > 0 ? 'border-l-8 border-l-[var(--sc-thinking)]' : ''}`}
            aria-label={t('familyHome.attention')}
            data-testid="family-attention-count"
          >
            <h2 className="mb-1 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyHome.attention')}</h2>
            {s.attentionCount === 0 ? (
              <p className="text-elder-body font-bold text-[var(--sc-ok)]">{t('familyHome.attentionNone')}</p>
            ) : (
              <p className="text-elder-body font-bold text-[var(--sc-thinking)]">
                {t('familyHome.attentionCount', { n: s.attentionCount })}
              </p>
            )}
            {s.openAlerts.length > 0 && (
              <p className="mt-1 text-xl text-[var(--sc-ink-soft)]">
                {t('familyHome.openAlerts', { n: s.openAlerts.length })}
                <a href="#/family/alerts" className="font-bold text-[var(--sc-idle-deep)] underline">
                  {t('familyHome.followUp')}
                </a>
              </p>
            )}
          </section>
        </div>
      )}

      <BottomNav items={FAMILY_NAV_ITEMS} />
    </main>
  );
}

/**
 * 家屬週報（路由 '/family/report'）：
 * ReportService.getWeeklyReport 動態計算（過去 7 日），嚴禁固定數字。
 */
import { getWeeklyReport } from '../services/ReportService';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { useI18n } from '../i18n';
import BottomNav, { FAMILY_NAV_ITEMS } from '../components/BottomNav';

export default function FamilyReport() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';

  const { data: report } = useAsyncData(
    () => (elderId ? getWeeklyReport(elderId) : Promise.resolve(null)),
    [dbVersion, elderId],
  );

  if (!ctx) return null;

  const r = report;

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      <h1 className="mb-1 font-serif-display text-elder-display text-ink">{t('familyReport.title')}</h1>
      <p className="mb-5 text-xl text-[var(--sc-ink-soft)]">
        {t('familyReport.period', { name: ctx.elderName, days: r?.periodDays ?? 7 })}
      </p>

      {!r ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          {t('familyReport.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="weekly-report">
          {/* AI 摘要 */}
          <section className="card-elder border-l-8 border-l-[var(--sc-idle)]" aria-label={t('familyReport.summary')}>
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.summary')}</h2>
            <p className="text-elder-body leading-relaxed">{r.aiSummary}</p>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <section className="card-elder" aria-label={t('familyReport.adherence')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.adherence')}</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-idle-deep)]">
                {r.medicationAdherence.expected > 0
                  ? `${Math.round(r.medicationAdherence.rate * 100)}%`
                  : '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">
                {t('familyReport.adherenceCount', {
                  taken: r.medicationAdherence.taken,
                  expected: r.medicationAdherence.expected,
                })}
              </p>
            </section>
            <section className="card-elder" aria-label={t('familyReport.records')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.records')}</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-ink)]">
                {r.recordCount}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">{t('familyReport.recordsUnit')}</p>
            </section>
            <section className="card-elder" aria-label={t('familyReport.bpAvg')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.bpAvg')}</h2>
              <p className="font-serif-display text-3xl font-black text-[var(--sc-ink)]">
                {r.bpAverage ? `${r.bpAverage.systolic}/${r.bpAverage.diastolic}` : '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">mmHg</p>
            </section>
            <section className="card-elder" aria-label={t('familyReport.glucoseAvg')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.glucoseAvg')}</h2>
              <p className="font-serif-display text-3xl font-black text-[var(--sc-ink)]">
                {r.glucoseAverage ?? '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">mmol/L</p>
            </section>
          </div>

          <section className="card-elder" aria-label={t('familyReport.events')}>
            <h2 className="mb-1 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.events')}</h2>
            <p className="text-elder-body font-bold">
              {r.eventCount === 0
                ? t('familyReport.eventsNone')
                : t('familyReport.eventsCount', { n: r.eventCount })}
            </p>
          </section>

          <section className="card-elder" aria-label={t('familyReport.symptoms')}>
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">{t('familyReport.symptoms')}</h2>
            {r.topSymptoms.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">{t('familyReport.symptomsNone')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {r.topSymptoms.slice(0, 5).map((s) => (
                  <li key={s.symptom} className="flex items-center justify-between text-xl">
                    <span>{s.symptom}</span>
                    <span className="font-bold text-[var(--sc-idle-deep)]">
                      {t('familyReport.countTimes', { n: s.count })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <BottomNav items={FAMILY_NAV_ITEMS} />
    </main>
  );
}

/**
 * 可打印總報告（路由 '/report'）：
 * A4 友好、結構化，供後續 Playwright 打印 PDF 使用。
 * 數據全部 DB 實算（週報 + 總覽 + 近期事件／提醒）。
 */
import { Link } from 'react-router-dom';

import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type { Alert, ChronicCondition, HealthEvent } from '../types/entities';
import { getWeeklyReport, type WeeklyReport } from '../services/ReportService';
import { getInsights, type DashboardInsights } from '../services/InsightService';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { useI18n } from '../i18n';

interface ReportData {
  report: WeeklyReport;
  insights: DashboardInsights;
  conditions: ChronicCondition[];
  recentEvents: HealthEvent[];
  recentAlerts: Alert[];
}

export default function ReportPage() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';

  const { data } = useAsyncData(async (): Promise<ReportData | null> => {
    if (!elderId) return null;
    const provider = getProvider();
    const [report, insights, conditions, events, alerts] = await Promise.all([
      getWeeklyReport(elderId),
      getInsights(),
      provider.list<ChronicCondition>(tableNameOf('ChronicCondition'), { elderId }),
      provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId }),
      provider.list<Alert>(tableNameOf('Alert'), { elderId }),
    ]);
    return {
      report,
      insights,
      conditions,
      recentEvents: events
        .filter((e) => e.severity !== 'normal')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10),
      recentAlerts: alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    };
  }, [dbVersion, elderId]);

  const today = new Date();

  return (
    <main
      data-testid="print-report"
      className="mx-auto w-full max-w-[210mm] px-5 py-8 print:max-w-none print:px-0 print:py-0"
    >
      <div className="mb-6 flex items-center justify-between print:mb-4">
        <Link
          to="/"
          className="text-xl font-bold text-[var(--sc-idle-deep)] underline underline-offset-4 print:hidden"
        >
          {t('report.back')}
        </Link>
        <button
          type="button"
          data-testid="print-button"
          className="btn-elder btn-primary !min-h-12 !px-6 text-xl print:hidden"
          onClick={() => window.print()}
        >
          {t('report.print')}
        </button>
      </div>

      {/* 報告頭 */}
      <header className="mb-8 border-b-4 border-ink pb-4">
        <p className="text-sm font-medium tracking-[0.3em] text-[var(--sc-muted)]">
          {t('report.kicker')}
        </p>
        <h1 className="font-serif-display text-4xl font-black">{t('report.title')}</h1>
        <p className="mt-1 text-lg text-[var(--sc-ink-soft)]">
          {t('report.generated', {
            year: today.getFullYear(),
            month: today.getMonth() + 1,
            day: today.getDate(),
          })}
        </p>
      </header>

      {!ctx || !data ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          {t('report.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {/* 長者檔案 */}
          <section aria-label={t('report.profile')}>
            <h2 className="report-h2">{t('report.profile')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xl">
              <div className="flex gap-2">
                <dt className="font-bold">{t('report.name')}</dt>
                <dd>{ctx.elderName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-bold">{t('report.age')}</dt>
                <dd>
                  {ctx.elder.age} {t('report.ageUnit')}
                </dd>
              </div>
              <div className="col-span-2 flex gap-2">
                <dt className="font-bold">{t('report.conditions')}</dt>
                <dd>
                  {data.conditions.length === 0
                    ? t('report.noConditions')
                    : data.conditions
                        .map((c) => `${c.name}（${t(`condition.${c.type}`)}）`)
                        .join('、')}
                </dd>
              </div>
            </dl>
          </section>

          {/* 週報 */}
          <section aria-label={t('report.weekly')}>
            <h2 className="report-h2">{t('report.weekly')}</h2>
            <p className="mb-3 rounded-lg bg-[var(--sc-idle-soft)] p-4 text-lg leading-relaxed">
              {data.report.aiSummary}
            </p>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>{t('report.adherence')}</th>
                  <td>
                    {data.report.medicationAdherence.expected > 0
                      ? `${Math.round(data.report.medicationAdherence.rate * 100)}%（${data.report.medicationAdherence.taken}/${data.report.medicationAdherence.expected}）`
                      : t('report.noSchedule')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.recordCount')}</th>
                  <td>
                    {data.report.recordCount} {t('report.recordCountUnit')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.events')}</th>
                  <td>
                    {data.report.eventCount} {t('report.eventsUnit')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.bpAvg')}</th>
                  <td>
                    {data.report.bpAverage
                      ? `${data.report.bpAverage.systolic}/${data.report.bpAverage.diastolic} mmHg`
                      : t('report.noData')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.glucoseAvg')}</th>
                  <td>
                    {data.report.glucoseAverage !== undefined
                      ? `${data.report.glucoseAverage} mmol/L`
                      : t('report.noData')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.symptoms')}</th>
                  <td>
                    {data.report.topSymptoms.length === 0
                      ? t('report.none')
                      : data.report.topSymptoms.map((s) => `${s.symptom}（${s.count}次）`).join('、')}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 總覽 */}
          <section aria-label={t('report.overview')}>
            <h2 className="report-h2">{t('report.overview')}</h2>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>{t('report.elderCount')}</th>
                  <td>
                    {data.insights.elderCount} {t('report.elderCountUnit')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.totalRecords')}</th>
                  <td>
                    {data.insights.totalRecordCount} {t('report.recordCountUnit')}
                  </td>
                </tr>
                <tr>
                  <th>{t('report.overallAdherence')}</th>
                  <td>{Math.round(data.insights.medicationAdherenceRate * 100)}%</td>
                </tr>
                <tr>
                  <th>{t('report.eventMix')}</th>
                  <td>
                    {t('insights.attention', { n: data.insights.attentionEventCount })} ·{' '}
                    {t('insights.urgent', { n: data.insights.urgentEventCount })}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 近期事件 */}
          <section aria-label={t('report.recentEvents')}>
            <h2 className="report-h2">{t('report.recentEvents')}</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>{t('report.time')}</th>
                  <th>{t('report.level')}</th>
                  <th>{t('report.content')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                    <td>{t(`severity.${e.severity}`)}</td>
                    <td>{e.summary}</td>
                  </tr>
                ))}
                {data.recentEvents.length === 0 && (
                  <tr>
                    <td colSpan={3}>{t('report.noEvents')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* 近期提醒 */}
          <section aria-label={t('report.recentAlerts')}>
            <h2 className="report-h2">{t('report.recentAlerts')}</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>{t('report.time')}</th>
                  <th>{t('report.status')}</th>
                  <th>{t('report.content')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAlerts.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td>
                      {t(
                        a.status === 'open'
                          ? 'familyAlerts.statusOpen'
                          : a.status === 'acknowledged'
                            ? 'familyAlerts.statusAcknowledged'
                            : 'familyAlerts.statusResolved',
                      )}
                    </td>
                    <td>{a.message}</td>
                  </tr>
                ))}
                {data.recentAlerts.length === 0 && (
                  <tr>
                    <td colSpan={3}>{t('report.noAlerts')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <footer className="mt-4 border-t border-[var(--sc-line)] pt-4 text-base text-[var(--sc-muted)]">
            {t('report.footer')}
          </footer>
        </div>
      )}
    </main>
  );
}

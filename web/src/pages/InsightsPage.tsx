/**
 * 數據洞察（路由 '/insights'）：InsightService 總覽 ——
 * 長者數、紀錄數、慢病分佈、服藥依從率、事件數、症狀分佈、7 日事件趨勢。
 * 全部 Recharts 實算，subscribe 自動刷新。
 */
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getInsights } from '../services/InsightService';
import { useAsyncData, useDbVersion } from '../lib/hooks';
import { useI18n } from '../i18n';
import SyncBadge from '../components/SyncBadge';

export default function InsightsPage() {
  const { t } = useI18n();
  const dbVersion = useDbVersion();
  const { data: ins } = useAsyncData(() => getInsights(), [dbVersion]);

  const conditionData = (ins?.chronicConditionDistribution ?? []).map((c) => ({
    name: t(`condition.${c.type}`),
    count: c.count,
  }));
  const symptomData = (ins?.symptomDistribution ?? []).slice(0, 8).map((s) => ({
    name: s.symptom,
    count: s.count,
  }));
  const trendData = (ins?.last7DayEventTrend ?? []).map((t) => ({
    day: t.date.slice(5).replace('-', '/'),
    count: t.count,
  }));

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-12 pt-6">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-sm font-medium tracking-widest text-[var(--sc-muted)]">INSIGHTS</p>
          <h1 className="font-serif-display text-elder-display text-ink">{t('insights.title')}</h1>
        </div>
        <SyncBadge />
      </header>

      {!ins ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          {t('insights.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="insights-dashboard">
          {/* 關鍵數字 */}
          <div className="grid grid-cols-2 gap-4">
            <section className="card-elder" aria-label={t('insights.elders')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('insights.elders')}</h2>
              <p className="font-serif-display text-4xl font-black">{ins.elderCount}</p>
              <p className="text-lg text-[var(--sc-ink-soft)]">{t('insights.eldersUnit')}</p>
            </section>
            <section className="card-elder" aria-label={t('insights.records')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('insights.records')}</h2>
              <p className="font-serif-display text-4xl font-black">{ins.totalRecordCount}</p>
              <p className="text-lg text-[var(--sc-ink-soft)]">{t('insights.recordsUnit')}</p>
            </section>
            <section className="card-elder" aria-label={t('insights.adherence')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('insights.adherence')}</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-idle-deep)]">
                {Math.round(ins.medicationAdherenceRate * 100)}%
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">{t('insights.adherenceUnit')}</p>
            </section>
            <section className="card-elder" aria-label={t('insights.events')}>
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">{t('insights.events')}</h2>
              <p className="text-elder-body font-bold">
                <span className="text-[var(--sc-thinking)]">
                  {t('insights.attention', { n: ins.attentionEventCount })}
                </span>
              </p>
              <p className="text-elder-body font-bold">
                <span className="text-[var(--sc-urgent)]">{t('insights.urgent', { n: ins.urgentEventCount })}</span>
              </p>
            </section>
          </div>

          {/* 慢病分佈 */}
          <section className="card-elder" aria-label={t('insights.conditions')}>
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('insights.conditions')}</h2>
            {conditionData.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">{t('insights.noData')}</p>
            ) : (
              <div data-testid="condition-chart" className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={conditionData} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                    <XAxis dataKey="name" tick={{ fontSize: 13 }} interval={0} />
                    <YAxis tick={{ fontSize: 13 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name={t('insights.people')} fill="var(--sc-idle)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* 症狀分佈 */}
          <section className="card-elder" aria-label={t('insights.symptoms')}>
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('insights.symptoms')}</h2>
            {symptomData.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">{t('insights.noData')}</p>
            ) : (
              <div data-testid="symptom-chart" className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={symptomData}
                    layout="vertical"
                    margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                    <XAxis type="number" tick={{ fontSize: 13 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 13 }} />
                    <Tooltip />
                    <Bar dataKey="count" name={t('insights.times')} fill="var(--sc-thinking)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* 7 日事件趨勢 */}
          <section className="card-elder" aria-label={t('insights.trend')}>
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">{t('insights.trend')}</h2>
            <div data-testid="trend-chart" className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                  <XAxis dataKey="day" tick={{ fontSize: 13 }} />
                  <YAxis tick={{ fontSize: 13 }} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name={t('insights.event')}
                    stroke="var(--sc-listening)"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="mt-2 flex justify-center gap-6 text-xl font-bold">
            <Link to="/report" className="text-[var(--sc-idle-deep)] underline underline-offset-4">
              {t('insights.report')}
            </Link>
            <Link to="/" className="text-[var(--sc-ink-soft)] underline underline-offset-4">
              {t('insights.back')}
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

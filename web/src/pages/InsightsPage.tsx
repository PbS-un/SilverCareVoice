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
import { CONDITION_LABELS } from '../lib/format';
import SyncBadge from '../components/SyncBadge';

export default function InsightsPage() {
  const dbVersion = useDbVersion();
  const { data: ins } = useAsyncData(() => getInsights(), [dbVersion]);

  const conditionData = (ins?.chronicConditionDistribution ?? []).map((c) => ({
    name: CONDITION_LABELS[c.type] ?? c.type,
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
          <h1 className="font-serif-display text-elder-display text-ink">數據洞察</h1>
        </div>
        <SyncBadge />
      </header>

      {!ins ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          統計緊……
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="insights-dashboard">
          {/* 關鍵數字 */}
          <div className="grid grid-cols-2 gap-4">
            <section className="card-elder" aria-label="長者數">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">長者</h2>
              <p className="font-serif-display text-4xl font-black">{ins.elderCount}</p>
              <p className="text-lg text-[var(--sc-ink-soft)]">位</p>
            </section>
            <section className="card-elder" aria-label="紀錄總數">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">健康記錄</h2>
              <p className="font-serif-display text-4xl font-black">{ins.totalRecordCount}</p>
              <p className="text-lg text-[var(--sc-ink-soft)]">項</p>
            </section>
            <section className="card-elder" aria-label="服藥依從率">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">服藥依從率</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-idle-deep)]">
                {Math.round(ins.medicationAdherenceRate * 100)}%
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">整體</p>
            </section>
            <section className="card-elder" aria-label="事件數">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">事件</h2>
              <p className="text-elder-body font-bold">
                <span className="text-[var(--sc-thinking)]">{ins.attentionEventCount} 留意</span>
              </p>
              <p className="text-elder-body font-bold">
                <span className="text-[var(--sc-urgent)]">{ins.urgentEventCount} 緊急</span>
              </p>
            </section>
          </div>

          {/* 慢病分佈 */}
          <section className="card-elder" aria-label="慢病分佈">
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">慢病分佈</h2>
            {conditionData.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">冇數據</p>
            ) : (
              <div data-testid="condition-chart" className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={conditionData} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sc-line)" />
                    <XAxis dataKey="name" tick={{ fontSize: 13 }} interval={0} />
                    <YAxis tick={{ fontSize: 13 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="人數" fill="var(--sc-idle)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* 症狀分佈 */}
          <section className="card-elder" aria-label="症狀分佈">
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">症狀分佈</h2>
            {symptomData.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">冇數據</p>
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
                    <Bar dataKey="count" name="次數" fill="var(--sc-thinking)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* 7 日事件趨勢 */}
          <section className="card-elder" aria-label="七日事件趨勢">
            <h2 className="mb-3 text-xl font-bold text-[var(--sc-ink-soft)]">近 7 日事件趨勢</h2>
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
                    name="事件"
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
              總報告
            </Link>
            <Link to="/" className="text-[var(--sc-ink-soft)] underline underline-offset-4">
              返回角色選擇
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

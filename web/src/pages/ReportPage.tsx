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
import { fmtDate, CONDITION_LABELS, SEVERITY_LABELS } from '../lib/format';

interface ReportData {
  report: WeeklyReport;
  insights: DashboardInsights;
  conditions: ChronicCondition[];
  recentEvents: HealthEvent[];
  recentAlerts: Alert[];
}

export default function ReportPage() {
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
          ← 返回
        </Link>
        <button
          type="button"
          data-testid="print-button"
          className="btn-elder btn-primary !min-h-12 !px-6 text-xl print:hidden"
          onClick={() => window.print()}
        >
          🖨 打印／存 PDF
        </button>
      </div>

      {/* 報告頭 */}
      <header className="mb-8 border-b-4 border-ink pb-4">
        <p className="text-sm font-medium tracking-[0.3em] text-[var(--sc-muted)]">
          SILVERCARE MACAU · 照護報告
        </p>
        <h1 className="font-serif-display text-4xl font-black">銀髮一句通 — 總報告</h1>
        <p className="mt-1 text-lg text-[var(--sc-ink-soft)]">
          生成日期：{today.getFullYear()} 年 {today.getMonth() + 1} 月 {today.getDate()} 日
        </p>
      </header>

      {!ctx || !data ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          統計緊……
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {/* 長者檔案 */}
          <section aria-label="長者檔案">
            <h2 className="report-h2">1. 長者檔案</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xl">
              <div className="flex gap-2">
                <dt className="font-bold">姓名：</dt>
                <dd>{ctx.elderName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-bold">年齡：</dt>
                <dd>{ctx.elder.age} 歲</dd>
              </div>
              <div className="col-span-2 flex gap-2">
                <dt className="font-bold">慢病：</dt>
                <dd>
                  {data.conditions.length === 0
                    ? '無記錄'
                    : data.conditions
                        .map((c) => `${c.name}（${CONDITION_LABELS[c.type] ?? c.type}）`)
                        .join('、')}
                </dd>
              </div>
            </dl>
          </section>

          {/* 週報 */}
          <section aria-label="週報">
            <h2 className="report-h2">2. 過去 7 日週報</h2>
            <p className="mb-3 rounded-lg bg-[var(--sc-idle-soft)] p-4 text-lg leading-relaxed">
              {data.report.aiSummary}
            </p>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>服藥依從率</th>
                  <td>
                    {data.report.medicationAdherence.expected > 0
                      ? `${Math.round(data.report.medicationAdherence.rate * 100)}%（${data.report.medicationAdherence.taken}/${data.report.medicationAdherence.expected}）`
                      : '期內無排程'}
                  </td>
                </tr>
                <tr>
                  <th>健康記錄數</th>
                  <td>{data.report.recordCount} 項</td>
                </tr>
                <tr>
                  <th>需要留意事件</th>
                  <td>{data.report.eventCount} 個</td>
                </tr>
                <tr>
                  <th>平均血壓</th>
                  <td>
                    {data.report.bpAverage
                      ? `${data.report.bpAverage.systolic}/${data.report.bpAverage.diastolic} mmHg`
                      : '期內無記錄'}
                  </td>
                </tr>
                <tr>
                  <th>平均血糖</th>
                  <td>
                    {data.report.glucoseAverage !== undefined
                      ? `${data.report.glucoseAverage} mmol/L`
                      : '期內無記錄'}
                  </td>
                </tr>
                <tr>
                  <th>常見症狀</th>
                  <td>
                    {data.report.topSymptoms.length === 0
                      ? '無'
                      : data.report.topSymptoms.map((s) => `${s.symptom}（${s.count}次）`).join('、')}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 總覽 */}
          <section aria-label="整體總覽">
            <h2 className="report-h2">3. 整體數據總覽</h2>
            <table className="report-table">
              <tbody>
                <tr>
                  <th>長者數</th>
                  <td>{data.insights.elderCount} 位</td>
                </tr>
                <tr>
                  <th>健康記錄總數</th>
                  <td>{data.insights.totalRecordCount} 項</td>
                </tr>
                <tr>
                  <th>整體服藥依從率</th>
                  <td>{Math.round(data.insights.medicationAdherenceRate * 100)}%</td>
                </tr>
                <tr>
                  <th>留意／緊急事件</th>
                  <td>
                    {data.insights.attentionEventCount} 留意 · {data.insights.urgentEventCount} 緊急
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* 近期事件 */}
          <section aria-label="近期健康事件">
            <h2 className="report-h2">4. 近期健康事件（最多 10 項）</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>級別</th>
                  <th>內容</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                    <td>{SEVERITY_LABELS[e.severity]}</td>
                    <td>{e.summary}</td>
                  </tr>
                ))}
                {data.recentEvents.length === 0 && (
                  <tr>
                    <td colSpan={3}>冇非正常事件</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* 近期提醒 */}
          <section aria-label="近期家屬提醒">
            <h2 className="report-h2">5. 近期家屬提醒（最多 10 項）</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>狀態</th>
                  <th>內容</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAlerts.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td>
                      {a.status === 'open' ? '未處理' : a.status === 'acknowledged' ? '知道了' : '已跟進'}
                    </td>
                    <td>{a.message}</td>
                  </tr>
                ))}
                {data.recentAlerts.length === 0 && (
                  <tr>
                    <td colSpan={3}>冇提醒</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <footer className="mt-4 border-t border-[var(--sc-line)] pt-4 text-base text-[var(--sc-muted)]">
            本報告由銀髮一句通按裝置數據庫實算生成，只供參考，不是醫療診斷。如有疑問請諮詢醫護人員。
          </footer>
        </div>
      )}
    </main>
  );
}

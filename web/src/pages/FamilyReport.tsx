/**
 * 家屬週報（路由 '/family/report'）：
 * ReportService.getWeeklyReport 動態計算（過去 7 日），嚴禁固定數字。
 */
import { getWeeklyReport } from '../services/ReportService';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import BottomNav, { FAMILY_NAV_ITEMS } from '../components/BottomNav';

export default function FamilyReport() {
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
      <h1 className="mb-1 font-serif-display text-elder-display text-ink">週報</h1>
      <p className="mb-5 text-xl text-[var(--sc-ink-soft)]">
        {ctx.elderName} · 過去 {r?.periodDays ?? 7} 日（由數據庫實算）
      </p>

      {!r ? (
        <p className="text-xl text-[var(--sc-ink-soft)]" role="status">
          統計緊……
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="weekly-report">
          {/* AI 摘要 */}
          <section className="card-elder border-l-8 border-l-[var(--sc-idle)]" aria-label="摘要">
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">本週摘要</h2>
            <p className="text-elder-body leading-relaxed">{r.aiSummary}</p>
          </section>

          <div className="grid grid-cols-2 gap-4">
            <section className="card-elder" aria-label="服藥依從率">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">服藥依從</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-idle-deep)]">
                {r.medicationAdherence.expected > 0
                  ? `${Math.round(r.medicationAdherence.rate * 100)}%`
                  : '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">
                {r.medicationAdherence.taken}/{r.medicationAdherence.expected} 次已服
              </p>
            </section>
            <section className="card-elder" aria-label="記錄數">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">健康記錄</h2>
              <p className="font-serif-display text-4xl font-black text-[var(--sc-ink)]">
                {r.recordCount}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">項（徵象＋症狀）</p>
            </section>
            <section className="card-elder" aria-label="平均血壓">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">平均血壓</h2>
              <p className="font-serif-display text-3xl font-black text-[var(--sc-ink)]">
                {r.bpAverage ? `${r.bpAverage.systolic}/${r.bpAverage.diastolic}` : '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">mmHg</p>
            </section>
            <section className="card-elder" aria-label="平均血糖">
              <h2 className="text-lg font-bold text-[var(--sc-ink-soft)]">平均血糖</h2>
              <p className="font-serif-display text-3xl font-black text-[var(--sc-ink)]">
                {r.glucoseAverage ?? '—'}
              </p>
              <p className="text-lg text-[var(--sc-ink-soft)]">mmol/L</p>
            </section>
          </div>

          <section className="card-elder" aria-label="健康事件">
            <h2 className="mb-1 text-lg font-bold text-[var(--sc-ink-soft)]">需要注意事件</h2>
            <p className="text-elder-body font-bold">
              {r.eventCount === 0 ? '本週冇觸發健康警示 ✓' : `${r.eventCount} 個`}
            </p>
          </section>

          <section className="card-elder" aria-label="常見症狀">
            <h2 className="mb-2 text-lg font-bold text-[var(--sc-ink-soft)]">常見症狀</h2>
            {r.topSymptoms.length === 0 ? (
              <p className="text-xl text-[var(--sc-muted)]">本週冇症狀記錄</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {r.topSymptoms.slice(0, 5).map((s) => (
                  <li key={s.symptom} className="flex items-center justify-between text-xl">
                    <span>{s.symptom}</span>
                    <span className="font-bold text-[var(--sc-idle-deep)]">{s.count} 次</span>
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

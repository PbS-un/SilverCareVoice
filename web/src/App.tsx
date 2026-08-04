/**
 * App 根元件（T6）：HashRouter 路由 + 啟動流程。
 *
 * 啟動：掛載時確保 seed（DB 空 → demoReset 初始化）+ ensureKnowledgeLoaded()。
 * 路由：/ 角色選擇；/elder、/elder/health（老人端）；/family、/family/health、
 * /family/alerts、/family/report（家屬端）；/insights 總覽；/report 可打印報告。
 * 老人端與家屬端進入前先經 RequireConsent（免責同意）。
 */
import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { getProvider } from './data/DataProvider';
import { tableNameOf } from './types/entities';
import { demoReset } from './data/demoReset';
import { ensureKnowledgeLoaded } from './core/kb/search';
import RequireConsent from './components/RequireConsent';
import RoleSelect from './pages/RoleSelect';
import ElderHome from './pages/ElderHome';
import ElderHealth from './pages/ElderHealth';
import FamilyHome from './pages/FamilyHome';
import FamilyHealth from './pages/FamilyHealth';
import FamilyAlerts from './pages/FamilyAlerts';
import FamilyReport from './pages/FamilyReport';
import InsightsPage from './pages/InsightsPage';
import ReportPage from './pages/ReportPage';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const provider = getProvider();
        const elders = await provider.list(tableNameOf('ElderProfile'));
        if (elders.length === 0) await demoReset();
        await ensureKnowledgeLoaded();
      } catch {
        /* 啟動容錯：即使載入出錯都呈現 UI，由頁面呈現空態 */
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!ready) {
    return (
      <main
        data-testid="app-root"
        className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-6 text-center"
      >
        <span
          aria-hidden
          className="animate-breathe block h-16 w-16 rounded-full bg-care-idle shadow-lg"
        />
        <h1 className="font-serif-display text-elder-title text-ink">銀髮一句通</h1>
        <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
          載入中……
        </p>
      </main>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<RoleSelect />} />

        <Route
          path="/elder"
          element={
            <RequireConsent>
              <ElderHome />
            </RequireConsent>
          }
        />
        <Route
          path="/elder/health"
          element={
            <RequireConsent>
              <ElderHealth />
            </RequireConsent>
          }
        />

        <Route
          path="/family"
          element={
            <RequireConsent>
              <FamilyHome />
            </RequireConsent>
          }
        />
        <Route
          path="/family/health"
          element={
            <RequireConsent>
              <FamilyHealth />
            </RequireConsent>
          }
        />
        <Route
          path="/family/alerts"
          element={
            <RequireConsent>
              <FamilyAlerts />
            </RequireConsent>
          }
        />
        <Route
          path="/family/report"
          element={
            <RequireConsent>
              <FamilyReport />
            </RequireConsent>
          }
        />

        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

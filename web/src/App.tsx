/**
 * App 根元件（T6）：HashRouter 路由 + 啟動流程。
 *
 * 啟動（Warning 3 修復：先等同步結論再判空庫，避免 demoReset 與 sync
 * bootstrap 競態）：掛載時 await enableSync()（探測 + bootstrap/pull 結論），
 * 其後才做空庫判斷 —— elders 空庫即 demoReset 初始化（不限 standalone：
 * 已配對且雲端有數據時 bootstrap 會在判空之前填滿本地庫，空庫時種子化
 * 永遠正確；雲端未配對訪客因此也能得到完整演示數據）。最後 ensureKnowledgeLoaded()。
 * 等待期間呈現載入狀態（不閃爍）。
 * 路由：/ 角色選擇；/elder、/elder/health（老人端）；/family、/family/health、
 * /family/alerts、/family/report（家屬端）；/insights 總覽；/report 可打印報告。
 * 老人端與家屬端進入前先經 RequireConsent（免責同意）。
 */
import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { getProvider, enableSync } from './data/DataProvider';
import { tableNameOf } from './types/entities';
import { demoReset, shouldSeedDemoData } from './data/demoReset';
import type { ElderProfile, User } from './types/entities';
import { ensureKnowledgeLoaded } from './core/kb/search';
import { LanguageProvider, useI18n } from './i18n';
import RequireConsent from './components/RequireConsent';
import RequireAuth from './components/RequireAuth';
import LoginPage from './pages/LoginPage';
import RoleSelect from './pages/RoleSelect';
import ElderHome from './pages/ElderHome';
import ElderHealth from './pages/ElderHealth';
import FamilyHome from './pages/FamilyHome';
import FamilyHealth from './pages/FamilyHealth';
import FamilyAlerts from './pages/FamilyAlerts';
import FamilyReport from './pages/FamilyReport';
import InsightsPage from './pages/InsightsPage';
import ReportPage from './pages/ReportPage';
import PrintBrief from './pages/PrintBrief';

function AppRoutes() {
  const [ready, setReady] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // 1) 先等同步探測 + bootstrap/pull 結論（冪等；絕不 throw）——
        //    sync 模式下資料有無由 server bootstrap 決定，杜絕空庫
        //    demoReset 與 bootstrap 競態（Warning 3）。
        await enableSync();
        // 2) 其後才做空庫判斷：elders 空庫即 demoReset（不再只看 standalone）。
        //    邏輯依據：已配對且雲端有數據時 bootstrap 會在判空之前填滿本地庫，
        //    所以空庫時種子化永遠是正確行為 —— 新房間首裝置或未配對訪客
        //    都得到完整演示數據。
        //    注意：sync 模式 demoReset 會把種子 push 上雲 —— 已配對裝置這是
        //    期望行為；未配對裝置 push 會 401 進 dead-letter（可接受，
        //    與既有 KB 文件寫入同行為）。
        const provider = getProvider();
        const elders = await provider.list(tableNameOf('ElderProfile'));
        const users = await provider.list<User>(tableNameOf('User'));
        // 空庫（既有）或舊版/雲端舊資料冇 demo account → 重灌 100 名合成長者
        if (shouldSeedDemoData(elders as ElderProfile[], users)) await demoReset();
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
        <h1 className="font-serif-display text-elder-title text-ink">{t('app.loadingTitle')}</h1>
        <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
          {t('app.loading')}
        </p>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <RoleSelect />
          </RequireAuth>
        }
      />

      <Route
        path="/elder"
        element={
          <RequireAuth>
            <RequireConsent>
              <ElderHome />
            </RequireConsent>
          </RequireAuth>
        }
      />
      <Route
        path="/elder/health"
        element={
          <RequireAuth>
            <RequireConsent>
              <ElderHealth />
            </RequireConsent>
          </RequireAuth>
        }
      />

      <Route
        path="/family"
        element={
          <RequireAuth>
            <RequireConsent>
              <FamilyHome />
            </RequireConsent>
          </RequireAuth>
        }
      />
      <Route
        path="/family/health"
        element={
          <RequireAuth>
            <RequireConsent>
              <FamilyHealth />
            </RequireConsent>
          </RequireAuth>
        }
      />
      <Route
        path="/family/alerts"
        element={
          <RequireAuth>
            <RequireConsent>
              <FamilyAlerts />
            </RequireConsent>
          </RequireAuth>
        }
      />
      <Route
        path="/family/report"
        element={
          <RequireAuth>
            <RequireConsent>
              <FamilyReport />
            </RequireConsent>
          </RequireAuth>
        }
      />

      <Route
        path="/insights"
        element={
          <RequireAuth>
            <InsightsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/report"
        element={
          <RequireAuth>
            <ReportPage />
          </RequireAuth>
        }
      />
      {/* /print-brief：公開例外（PDF 生成直接訪問） */}
      <Route path="/print-brief" element={<PrintBrief />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </LanguageProvider>
  );
}

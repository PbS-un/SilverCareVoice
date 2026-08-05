import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App 啟動與角色選擇頁', () => {
  beforeEach(() => {
    // T3：Demo Login —— 已登入（sessionStorage）才可見角色選擇
    sessionStorage.setItem('demoAuthenticated', 'true');
    // 重置 hash：避免上一測試導航到 /login 影響本測試（HashRouter 讀 window.location）
    window.history.replaceState({}, '', '/');
  });

  it('未登入時啟動後呈現 Demo Login（seed 自動初始化）', async () => {
    sessionStorage.removeItem('demoAuthenticated');
    render(<App />);
    expect(
      await screen.findByTestId('demo-login-form', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('登入後呈現角色選擇入口（seed 自動初始化）', async () => {
    render(<App />);
    // 啟動流程：DB 空 → demoReset → ensureKnowledgeLoaded → 路由 '/'
    expect(await screen.findByTestId('role-elder', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByTestId('role-family')).toBeInTheDocument();
    expect(screen.getByTestId('role-insights')).toBeInTheDocument();
    expect(screen.getByText('銀髮一句通')).toBeInTheDocument();
    expect(screen.getByTestId('demo-reset')).toBeInTheDocument();
  });
});

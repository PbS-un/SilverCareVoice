import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App 啟動與角色選擇頁', () => {
  it('啟動後呈現角色選擇入口（seed 自動初始化）', async () => {
    render(<App />);
    // 啟動流程：DB 空 → demoReset → ensureKnowledgeLoaded → 路由 '/'
    expect(await screen.findByTestId('role-elder', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByTestId('role-family')).toBeInTheDocument();
    expect(screen.getByTestId('role-insights')).toBeInTheDocument();
    expect(screen.getByText('銀髮一句通')).toBeInTheDocument();
    expect(screen.getByTestId('demo-reset')).toBeInTheDocument();
  });
});

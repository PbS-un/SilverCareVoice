/**
 * T3 LoginPage 測試：100 長者選擇器 autofill、新密碼登入、tester/tester 拒絕。
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { getProvider } from '../../data/DataProvider';
import { demoReset } from '../../data/demoReset';
import { seedData } from '../../data/seed';
import { LanguageProvider } from '../../i18n';
import { getDemoSession } from '../../lib/demoAuth';
import type { SeedData } from '../../data/DataProvider';
import LoginPage from '../LoginPage';

async function renderLogin() {
  await demoReset(); // 100 名合成長者 seed
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('LoginPage（100 Demo 長者）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('列出 100 位示範長者', async () => {
    await renderLogin();
    const select = screen.getByTestId('demo-elder-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(100));
    expect(screen.getByText(/陳婆婆，78歲/)).toBeInTheDocument();
  });

  it('揀長者後帳號密碼自動填入（masked），一鍵登入寫 session', async () => {
    await renderLogin();
    const select = screen.getByTestId('demo-elder-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(100));
    fireEvent.change(select, { target: { value: 'seed-elder-01' } });
    expect(screen.getByTestId('demo-login-id')).toHaveValue('demo-001');
    const pwd = screen.getByTestId('demo-login-password');
    expect(pwd).toHaveValue('SCV-Demo!2026-001-Macau');
    expect(pwd).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    await waitFor(() => expect(getDemoSession()?.elderId).toBe('seed-elder-01'));
  });

  it('tester/tester 拒絕並顯示錯誤', async () => {
    await renderLogin();
    const select = screen.getByTestId('demo-elder-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(100));
    fireEvent.change(select, { target: { value: 'seed-elder-01' } });
    fireEvent.change(screen.getByTestId('demo-login-id'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByTestId('demo-login-password'), { target: { value: 'tester' } });
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    expect(await screen.findByTestId('demo-login-error')).toHaveTextContent('ID 或密碼錯誤');
    expect(getDemoSession()).toBeNull();
  });

  it('錯誤密碼失敗（唔寫 session）', async () => {
    await renderLogin();
    const select = screen.getByTestId('demo-elder-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(100));
    fireEvent.change(select, { target: { value: 'seed-elder-01' } });
    fireEvent.change(screen.getByTestId('demo-login-password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    expect(await screen.findByTestId('demo-login-error')).toHaveTextContent('ID 或密碼錯誤');
    expect(getDemoSession()).toBeNull();
  });

  it('舊版單長者資料（無 demo account）→ 顯示空態 + 一鍵重灌後出返 100 人', async () => {
    // 模擬雲端/舊版拉到嘅 legacy seed：1 位長者，account 冇 accountCode
    const legacy: SeedData = {
      users: [
        {
          id: 'legacy-user-elder',
          name: '陳婆婆',
          role: 'elder',
          refId: 'seed-elder-01',
          language: 'zh-HK',
          createdAt: '',
          updatedAt: '',
        },
      ],
      elderProfiles: [seedData.elderProfiles[0]],
      caregivers: [seedData.caregivers[0]],
      caregiverLinks: [seedData.caregiverLinks[0]],
      chronicConditions: [],
      vitalRecords: [],
      medications: [],
      medicationLogs: [],
      symptomRecords: [],
      appointments: [],
      healthEvents: [],
      alerts: [],
      caregiverFollowUps: [],
      conversations: [],
      serviceQueries: [],
      consents: [],
      auditLogs: [],
      resourceDirectory: [],
      knowledgeDocuments: [],
    };
    await getProvider().reset(legacy);

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    // 空態提示出現
    expect(await screen.findByTestId('login-no-demo-data', {}, { timeout: 10_000 })).toBeInTheDocument();
    // 一鍵重灌
    fireEvent.click(screen.getByTestId('login-reseed'));
    const select = screen.getByTestId('demo-elder-select');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(100));
    expect(screen.getByText(/陳婆婆，78歲/)).toBeInTheDocument();
  });
});

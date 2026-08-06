/**
 * T3 LoginPage 測試：100 長者選擇器 autofill、新密碼登入、tester/tester 拒絕。
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { demoReset } from '../../data/demoReset';
import { LanguageProvider } from '../../i18n';
import { getDemoSession } from '../../lib/demoAuth';
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
});

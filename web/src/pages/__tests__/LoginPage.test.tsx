/**
 * T3 LoginPage 測試：錯誤顯示／成功登入寫 sessionStorage／語言切換。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { LanguageProvider } from '../../i18n';
import LoginPage from '../LoginPage';

function renderLogin() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('tester / tester 登入成功並寫 sessionStorage', () => {
    renderLogin();
    fireEvent.change(screen.getByTestId('demo-login-id'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByTestId('demo-login-password'), { target: { value: 'tester' } });
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    expect(sessionStorage.getItem('demoAuthenticated')).toBe('true');
  });

  it('錯誤密碼顯示 user-friendly error，不寫 sessionStorage', () => {
    renderLogin();
    fireEvent.change(screen.getByTestId('demo-login-id'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByTestId('demo-login-password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    expect(screen.getByTestId('demo-login-error')).toHaveTextContent('ID 或密碼錯誤');
    expect(sessionStorage.getItem('demoAuthenticated')).toBeNull();
  });

  it('切換語言後錯誤訊息跟隨語言', () => {
    renderLogin();
    // 切到英文
    fireEvent.change(screen.getByTestId('language-selector'), { target: { value: 'en' } });
    fireEvent.change(screen.getByTestId('demo-login-id'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByTestId('demo-login-password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('demo-login-submit'));
    expect(screen.getByTestId('demo-login-error')).toHaveTextContent('Invalid ID or password');
  });
});

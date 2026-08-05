/**
 * T3 Demo Login 單元測試：固定憑證、sessionStorage、trim ID。
 */
import {
  DEMO_ID,
  DEMO_PASSWORD,
  AUTH_STORAGE_KEY,
  isDemoAuthenticated,
  setDemoAuthenticated,
  validateDemoLogin,
} from '../demoAuth';

describe('validateDemoLogin', () => {
  it('tester / tester 成功', () => {
    expect(validateDemoLogin(DEMO_ID, DEMO_PASSWORD)).toBe(true);
  });

  it('ID 可 trim', () => {
    expect(validateDemoLogin('  tester  ', DEMO_PASSWORD)).toBe(true);
  });

  it('錯誤密碼失敗', () => {
    expect(validateDemoLogin(DEMO_ID, 'wrong')).toBe(false);
  });

  it('錯誤 ID 失敗', () => {
    expect(validateDemoLogin('admin', DEMO_PASSWORD)).toBe(false);
  });
});

describe('sessionStorage', () => {
  beforeEach(() => sessionStorage.clear());

  it('setDemoAuthenticated(true) 後 isDemoAuthenticated 為 true（refresh 同 session 保持）', () => {
    expect(isDemoAuthenticated()).toBe(false);
    setDemoAuthenticated(true);
    expect(sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe('true');
    expect(isDemoAuthenticated()).toBe(true);
  });

  it('setDemoAuthenticated(false) 清除登入狀態', () => {
    setDemoAuthenticated(true);
    setDemoAuthenticated(false);
    expect(isDemoAuthenticated()).toBe(false);
  });
});

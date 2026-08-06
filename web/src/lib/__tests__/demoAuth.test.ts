/**
 * T3 Demo Login 單元測試：account code 衍生密碼、tester/tester 拒絕、session。
 */
import {
  demoPasswordFor,
  getDemoSession,
  isDemoAuthenticated,
  setDemoSession,
  validateDemoCredentials,
} from '../demoAuth';

describe('demoPasswordFor / validateDemoCredentials', () => {
  it('由 account code 衍生 deterministic 密碼', () => {
    expect(demoPasswordFor('demo-001')).toBe('SCV-Demo!2026-001-Macau');
    expect(demoPasswordFor('demo-100')).toBe('SCV-Demo!2026-100-Macau');
  });

  it('正確憑證通過（ID 可 trim）', () => {
    expect(validateDemoCredentials('demo-001', 'demo-001', 'SCV-Demo!2026-001-Macau')).toBe(true);
    expect(validateDemoCredentials('demo-001', '  demo-001  ', 'SCV-Demo!2026-001-Macau')).toBe(true);
  });

  it('tester/tester 必然拒絕', () => {
    expect(validateDemoCredentials('demo-001', 'tester', 'tester')).toBe(false);
    expect(validateDemoCredentials(undefined, 'tester', 'tester')).toBe(false);
  });

  it('錯誤密碼／錯誤帳號失敗', () => {
    expect(validateDemoCredentials('demo-001', 'demo-001', 'wrong')).toBe(false);
    expect(validateDemoCredentials('demo-002', 'demo-001', 'SCV-Demo!2026-001-Macau')).toBe(false);
  });
});

describe('sessionStorage demo session', () => {
  beforeEach(() => sessionStorage.clear());

  it('setDemoSession 後 isDemoAuthenticated 為 true，getDemoSession 回完整綁定', () => {
    expect(isDemoAuthenticated()).toBe(false);
    setDemoSession({
      accountCode: 'demo-001',
      accountId: 'a1',
      elderId: 'seed-elder-01',
      caregiverId: 'seed-caregiver-01',
      elderName: '陳婆婆',
    });
    expect(isDemoAuthenticated()).toBe(true);
    const s = getDemoSession();
    expect(s?.elderId).toBe('seed-elder-01');
    expect(s?.caregiverId).toBe('seed-caregiver-01');
  });
});

/**
 * Demo Login（T3）
 *
 * 只係 Demo gate，唔係正式 authentication：
 *  - 固定憑證 ID/Password 均為 tester
 *  - sessionStorage 保存 demoAuthenticated（同一 tab/session refresh 保持登入，
 *    關閉 session 後重新要求 Login）
 *  - 禁止把密碼存 localStorage／IndexedDB
 */

export const DEMO_ID = 'tester';
export const DEMO_PASSWORD = 'tester';
export const AUTH_STORAGE_KEY = 'demoAuthenticated';

/** 是否已通過 Demo Login（storage 不可用時視為未登入，絕不拋錯）。 */
export function isDemoAuthenticated(): boolean {
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** 設定登入狀態（寫入失敗不影響流程）。 */
export function setDemoAuthenticated(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
    else sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* 私隱模式等環境忽略 */
  }
}

/** 驗證 Demo 憑證：ID 可 trim，Password 精確比對。 */
export function validateDemoLogin(id: string, password: string): boolean {
  return id.trim() === DEMO_ID && password === DEMO_PASSWORD;
}

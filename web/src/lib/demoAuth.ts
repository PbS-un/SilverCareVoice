/**
 * Demo Login（T3：100 合成長者 Account）
 *
 * 移除舊 tester/tester；每個 Demo account 對應「一名 Elder + 一名 Guardian」。
 *  - username = accountCode（demo-001 … demo-100）
 *  - password = SCV-Demo!2026-<NNN>-Macau（deterministic，密碼輸入保持 masked）
 *  - sessionStorage 保存 account→elder→guardian 綁定，refresh 同 session 保持登入
 *  - 本質上只係 frontend gating（GitHub Pages standalone 無法真正鑑權），README 已如實說明
 *  - 禁止把密碼存 localStorage／IndexedDB
 */

export const AUTH_STORAGE_KEY = 'scv.demo.session.v1';

export interface DemoSession {
  /** account code（demo-001 … demo-100），同時係登入 username。 */
  accountCode: string;
  accountId: string;
  elderId: string;
  caregiverId: string;
  elderName: string;
}

/** 由 account code 衍生 deterministic demo password（例：SCV-Demo!2026-001-Macau）。 */
export function demoPasswordFor(accountCode: string): string {
  const num = /^demo-(\d+)$/.exec(accountCode.trim());
  const seq = num ? num[1].padStart(3, '0') : '001';
  return `SCV-Demo!2026-${seq}-Macau`;
}

/** 驗證 Demo 憑證：ID 可 trim，密碼精確比對衍生值（tester/tester 必然拒絕）。 */
export function validateDemoCredentials(
  accountCode: string | undefined,
  id: string,
  password: string,
): boolean {
  if (!accountCode) return false;
  return id.trim() === accountCode.trim() && password === demoPasswordFor(accountCode);
}

/** 讀取目前登入 session（storage 不可用時回 null，絕不拋錯）。 */
export function getDemoSession(): DemoSession | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    if (parsed && parsed.elderId && parsed.accountCode) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** 寫入登入 session。 */
export function setDemoSession(session: DemoSession): void {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* 私隱模式等環境忽略 */
  }
}

/** 清除登入 session。 */
export function clearDemoSession(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 是否已通過 Demo Login。 */
export function isDemoAuthenticated(): boolean {
  return getDemoSession() !== null;
}

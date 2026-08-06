/**
 * SilverCare Voice — Demo 重置（T2）
 *
 * 走與正式資料完全相同的 repository 路徑：provider.reset(seedData)。
 * 嚴禁 demo-only 分支 —— 重置即「清表 + 寫種子」，與任何 provider 實作一致。
 */

import { getProvider } from './DataProvider';
import { seedData } from './seed';
import type { ElderProfile, User } from '../types/entities';

/** 將資料層重置為陳婆婆完整 demo 種子。 */
export async function demoReset(): Promise<void> {
  await getProvider().reset(seedData);
}

/**
 * 判斷是否需要灌入 100 名合成長者 demo seed：
 *  - 空庫（既有行為）
 *  - 有長者但冇任何「demo account 綁定」（舊版 1 位長者 seed／雲端舊資料）——
 *    登入頁需要 accountCode 先出到選項，舊資料會令「示範長者選擇」空白。
 */
export function shouldSeedDemoData(elders: ElderProfile[], users: User[]): boolean {
  if (elders.length === 0) return true;
  return !users.some(
    (u) =>
      u.role === 'elder' &&
      Boolean(u.accountCode) &&
      elders.some((e) => e.id === u.refId),
  );
}

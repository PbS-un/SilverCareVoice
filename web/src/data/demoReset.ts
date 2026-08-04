/**
 * SilverCare Voice — Demo 重置（T2）
 *
 * 走與正式資料完全相同的 repository 路徑：provider.reset(seedData)。
 * 嚴禁 demo-only 分支 —— 重置即「清表 + 寫種子」，與任何 provider 實作一致。
 */

import { getProvider } from './DataProvider';
import { seedData } from './seed';

/** 將資料層重置為陳婆婆完整 demo 種子。 */
export async function demoReset(): Promise<void> {
  await getProvider().reset(seedData);
}

/**
 * E2E globalSetup（Playwright）—— 確保 sync server 上有乾淨的 demo seed。
 *
 * 背景：App 啟動只在 standalone 空庫時 demoReset（Warning 3 修復後不再與
 * sync bootstrap 競態）；sync 模式下資料有無由 server 決定。因此 E2E 啟動前
 * 在 server 端做一次「demo reset」：對全部當前實體發 tombstone（ts = now），
 * 再寫入 seed put（ts = now+1ms，與 SyncedProvider.reset 的重蓋章語義一致），
 * 保證每個 E2E 執行都從確定性的示範資料出發。
 *
 * token：與 playwright.config.ts 的 server env SYNC_TOKEN 一致（預設 e2e-sync-token）。
 */
import { seedData } from '../../seed';
import { TABLE_TO_ENTITY } from '../wire';

/** 最小 node 環境型別（此檔不引入 @types/node）。 */
declare const process: { env: Record<string, string | undefined> };

const BASE = process.env.E2E_SYNC_BASE ?? 'http://localhost:8787';
const TOKEN = process.env.SYNC_TOKEN ?? 'e2e-sync-token';

interface WireSeedOp {
  id: string;
  tbl: string;
  entityId: string;
  updatedAt: string;
  type: 'put' | 'del';
  payload?: Record<string, unknown>;
}

function uuid(): string {
  return crypto.randomUUID();
}

export default async function e2eGlobalSetup(): Promise<void> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

  // 1) 取當前 server 狀態
  let entities: { tbl: string; entityId: string }[] = [];
  const bootRes = await fetch(`${BASE}/sync/bootstrap`, { headers }).catch((e: unknown) => {
    throw new Error(`無法連線 sync server ${BASE}：${e instanceof Error ? e.message : String(e)}`);
  });
  if (bootRes.status === 401) {
    throw new Error('E2E globalSetup：/sync/bootstrap 回 401 —— SYNC_TOKEN 與 server 不一致');
  }
  if (!bootRes.ok) throw new Error(`E2E globalSetup：/sync/bootstrap 回 HTTP ${bootRes.status}`);
  entities = ((await bootRes.json()) as { entities: { tbl: string; entityId: string }[] }).entities;

  // 2) tombstone 全部現存實體 → 寫入 seed（重蓋章：seedTs 嚴格晚於 delTs）
  const delTs = new Date().toISOString();
  const seedTs = new Date(Date.parse(delTs) + 1).toISOString();
  const ops: WireSeedOp[] = entities.map((e) => ({
    id: uuid(),
    tbl: e.tbl,
    entityId: e.entityId,
    updatedAt: delTs,
    type: 'del',
  }));
  for (const [table, entityName] of Object.entries(TABLE_TO_ENTITY)) {
    const rows = seedData[table as keyof typeof seedData] as { id: string }[];
    for (const item of rows) {
      ops.push({
        id: uuid(),
        tbl: entityName,
        entityId: item.id,
        updatedAt: seedTs,
        type: 'put',
        payload: { ...item, updatedAt: seedTs },
      });
    }
  }

  // 3) 分批 push（server 單批上限 500）
  for (let i = 0; i < ops.length; i += 400) {
    const res = await fetch(`${BASE}/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: 'e2e-seeder', ops: ops.slice(i, i + 400) }),
    });
    if (!res.ok) throw new Error(`E2E globalSetup：seed push 回 HTTP ${res.status}：${await res.text()}`);
  }
  console.log(
    `[e2e-global-setup] server seed 完成：${entities.length} 筆 tombstone + ${ops.length - entities.length} 筆 seed put`,
  );
}

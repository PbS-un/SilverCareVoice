/**
 * 銀髮一句通 SilverCare Macau — 本地同步 SQLite 儲存層
 *
 * 設計：op-log + 當前狀態視圖
 *  - ops:      追加式操作日誌（push/pull 增量同步的真實來源）
 *              每筆 op 帶 server 端單調遞增序號 `seq`（AUTOINCREMENT）——
 *              pull 游標一律用 seq，絕不用客戶端 updatedAt（客戶端時鐘
 *              可慢/可錯，用時間游標會永久遺漏離線裝置的 op）。
 *              updatedAt 只保留作 LWW 比較。
 *  - entities: (tbl, entity_id) 合併主鍵的 LWW 當前狀態；
 *              device_id 記錄最後寫入裝置，用於確定性 tiebreaker：
 *              updatedAt 相同時比較 deviceId 字典序（大者勝），
 *              server 與客戶端 applyOps 同一規則 → 同毫秒雙寫不分叉。
 *
 * SQLite 檔案：server/data/sync.sqlite（已 gitignore），WAL 模式。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

/** 表名白名單（19 實體） */
export const TABLE_WHITELIST = [
  'User',
  'ElderProfile',
  'Caregiver',
  'CaregiverLink',
  'ChronicCondition',
  'VitalRecord',
  'Medication',
  'MedicationLog',
  'SymptomRecord',
  'Appointment',
  'HealthEvent',
  'Alert',
  'CaregiverFollowUp',
  'Conversation',
  'ServiceQuery',
  'Consent',
  'AuditLog',
  'ResourceDirectory',
  'KnowledgeDocument',
]

/** pull 單頁上限（分頁：客戶端以 cursor 續拉）。 */
export const PULL_PAGE_SIZE = 1000

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'sync.sqlite'))
db.pragma('journal_mode = WAL')

/* ────────────────────────── schema 與遷移 ────────────────────────── */

const OPS_TABLE_SQL = `
  CREATE TABLE ops (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    id          TEXT NOT NULL UNIQUE,
    device_id   TEXT NOT NULL,
    tbl         TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('put', 'del')),
    payload     TEXT NOT NULL
  )`

db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    tbl         TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    device_id   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tbl, entity_id)
  );
`)

db.transaction(() => {
  // entities 遷移：舊版無 device_id（LWW tiebreaker 用）
  const entityCols = db.prepare('PRAGMA table_info(entities)').all().map((c) => c.name)
  if (!entityCols.includes('device_id')) {
    db.exec(`ALTER TABLE entities ADD COLUMN device_id TEXT NOT NULL DEFAULT ''`)
  }

  // ops 遷移：舊版無 server 端 seq（游標改 seq 的 Critical 修復）
  const hasOps = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ops'`).get()
  if (!hasOps) {
    db.exec(OPS_TABLE_SQL)
  } else {
    const opsCols = db.prepare('PRAGMA table_info(ops)').all().map((c) => c.name)
    if (!opsCols.includes('seq')) {
      db.exec(`
        ALTER TABLE ops RENAME TO ops_legacy;
        ${OPS_TABLE_SQL};
        INSERT INTO ops (id, device_id, tbl, entity_id, updated_at, type, payload)
          SELECT id, device_id, tbl, entity_id, updated_at, type, payload
          FROM ops_legacy ORDER BY rowid;
        DROP TABLE ops_legacy;
      `)
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ops_tbl_entity ON ops (tbl, entity_id);`)
})()

const insertOp = db.prepare(
  `INSERT OR IGNORE INTO ops (id, device_id, tbl, entity_id, updated_at, type, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const getEntityState = db.prepare(
  `SELECT updated_at, device_id FROM entities WHERE tbl = ? AND entity_id = ?`,
)
const upsertEntity = db.prepare(
  `INSERT INTO entities (tbl, entity_id, updated_at, payload, deleted, device_id)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT (tbl, entity_id)
   DO UPDATE SET updated_at = excluded.updated_at,
                 payload    = excluded.payload,
                 deleted    = excluded.deleted,
                 device_id  = excluded.device_id`,
)

/**
 * LWW 勝負判定（確定性，與客戶端 applyOps 同一規則）：
 * updatedAt 較新者勝；平手時 deviceId 字典序較大者勝。
 */
function incomingWins(opUpdatedAt, opDeviceId, curUpdatedAt, curDeviceId) {
  if (opUpdatedAt > curUpdatedAt) return true
  if (opUpdatedAt < curUpdatedAt) return false
  return opDeviceId > curDeviceId
}

/**
 * 應用一批 ops（LWW 合併，單一 transaction）。
 * 每筆 op 都會記入 ops 日誌（重複 id 除外）；是否覆蓋當前狀態依 LWW。
 * @param {string} deviceId 來源裝置
 * @param {Array<{id:string,tbl:string,entityId:string,updatedAt:string,type:'put'|'del',payload?:object}>} ops
 * @returns {{ applied: string[], rejected: string[], duplicated: string[] }}
 *   applied = 覆蓋當前狀態的 op id；rejected = 記入日誌但被 LWW 拒絕的 op id；
 *   duplicated = 重複推送（日誌已有）的 op id。三者皆「server 已收妥」，
 *   客戶端可安全出隊（rejected 需 warn）。
 */
export function pushOps(deviceId, ops) {
  const applied = []
  const rejected = []
  const duplicated = []
  const tx = db.transaction((list) => {
    for (const op of list) {
      const payload = JSON.stringify(op.payload ?? {})
      const info = insertOp.run(op.id, deviceId, op.tbl, op.entityId, op.updatedAt, op.type, payload)
      if (info.changes === 0) {
        duplicated.push(op.id) // 重複 op id，忽略
        continue
      }
      const existing = getEntityState.get(op.tbl, op.entityId)
      if (existing && !incomingWins(op.updatedAt, deviceId, existing.updated_at, existing.device_id)) {
        rejected.push(op.id) // LWW：較舊不覆蓋（op 仍在日誌，可供其他裝置 pull）
        continue
      }
      upsertEntity.run(op.tbl, op.entityId, op.updatedAt, payload, op.type === 'del' ? 1 : 0, deviceId)
      applied.push(op.id)
    }
  })
  tx(ops)
  return { applied, rejected, duplicated }
}

/** 全部當前狀態（首次加入裝置用；含 tombstone 以便客戶端刪除本地副本） */
export function bootstrapState() {
  const rows = db
    .prepare(
      `SELECT tbl, entity_id AS entityId, updated_at AS updatedAt, payload, deleted,
              device_id AS deviceId
       FROM entities ORDER BY tbl, entity_id`,
    )
    .all()
  return rows.map((r) => ({
    tbl: r.tbl,
    entityId: r.entityId,
    updatedAt: r.updatedAt,
    payload: JSON.parse(r.payload),
    deleted: Boolean(r.deleted),
    deviceId: r.deviceId,
  }))
}

/**
 * 增量拉取：server 端 seq 嚴格大於 cursor 的 ops（單頁上限 PULL_PAGE_SIZE）。
 * 回傳 cursor = 本頁最大 seq（字串）；無新資料時回傳原 cursor。
 * @param {number} cursor 上次 pull 回傳的 seq（0 = 從頭）
 */
export function pullSince(cursor) {
  const rows = db
    .prepare(
      `SELECT seq, id, device_id AS deviceId, tbl, entity_id AS entityId,
              updated_at AS updatedAt, type, payload
       FROM ops WHERE seq > ? ORDER BY seq LIMIT ?`,
    )
    .all(cursor, PULL_PAGE_SIZE)
  const ops = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
  return { ops, cursor: rows.length > 0 ? String(rows[rows.length - 1].seq) : String(cursor) }
}

/** ops 日誌當前最大 seq（bootstrap 後作為游標起點；空庫為 0）。 */
export function maxSeq() {
  return db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM ops`).get().m
}

export function serverNow() {
  return new Date().toISOString()
}

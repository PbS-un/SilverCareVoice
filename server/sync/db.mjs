/**
 * 銀髮一句通 SilverCare Macau — 本地同步 SQLite 儲存層
 *
 * 設計：op-log + 當前狀態視圖
 *  - ops:      追加式操作日誌（push/pull 增量同步的真實來源）
 *  - entities: (tbl, entity_id) 合併主鍵的 LWW 當前狀態
 *              push 時僅當 incoming.updated_at 較新才覆蓋；del 寫 tombstone
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'sync.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS ops (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    tbl         TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('put', 'del')),
    payload     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_tbl_entity ON ops (tbl, entity_id);
  CREATE INDEX IF NOT EXISTS idx_ops_updated_at ON ops (updated_at);

  CREATE TABLE IF NOT EXISTS entities (
    tbl         TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tbl, entity_id)
  );
`)

const insertOp = db.prepare(
  `INSERT OR IGNORE INTO ops (id, device_id, tbl, entity_id, updated_at, type, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const getEntityTs = db.prepare(
  `SELECT updated_at FROM entities WHERE tbl = ? AND entity_id = ?`,
)
const upsertEntity = db.prepare(
  `INSERT INTO entities (tbl, entity_id, updated_at, payload, deleted)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (tbl, entity_id)
   DO UPDATE SET updated_at = excluded.updated_at,
                 payload    = excluded.payload,
                 deleted    = excluded.deleted`,
)

/**
 * 應用一批 ops（LWW 合併，單一 transaction）。
 * @param {string} deviceId 來源裝置
 * @param {Array<{id:string,tbl:string,entityId:string,updatedAt:string,type:'put'|'del',payload?:object}>} ops
 * @returns {number} 實際套用到當前狀態的筆數
 */
export function pushOps(deviceId, ops) {
  let applied = 0
  const tx = db.transaction((list) => {
    for (const op of list) {
      const payload = JSON.stringify(op.payload ?? {})
      const info = insertOp.run(op.id, deviceId, op.tbl, op.entityId, op.updatedAt, op.type, payload)
      if (info.changes === 0) continue // 重複 op id，忽略
      const existing = getEntityTs.get(op.tbl, op.entityId)
      if (existing && existing.updated_at >= op.updatedAt) continue // LWW：較舊不覆蓋
      upsertEntity.run(op.tbl, op.entityId, op.updatedAt, payload, op.type === 'del' ? 1 : 0)
      applied += 1
    }
  })
  tx(ops)
  return applied
}

/** 全部當前狀態（首次加入裝置用；含 tombstone 以便客戶端刪除本地副本） */
export function bootstrapState() {
  const rows = db
    .prepare(
      `SELECT tbl, entity_id AS entityId, updated_at AS updatedAt, payload, deleted
       FROM entities ORDER BY tbl, entity_id`,
    )
    .all()
  return rows.map((r) => ({
    tbl: r.tbl,
    entityId: r.entityId,
    updatedAt: r.updatedAt,
    payload: JSON.parse(r.payload),
    deleted: Boolean(r.deleted),
  }))
}

/** 增量拉取：updated_at 嚴格大於 since 的 ops */
export function pullSince(since) {
  const rows = db
    .prepare(
      `SELECT id, device_id AS deviceId, tbl, entity_id AS entityId,
              updated_at AS updatedAt, type, payload
       FROM ops WHERE updated_at > ? ORDER BY updated_at, rowid`,
    )
    .all(since)
  const ops = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
  return { ops, cursor: ops.length > 0 ? ops[ops.length - 1].updatedAt : since }
}

export function serverNow() {
  return new Date().toISOString()
}

-- ============================================================================
-- SilverCareVoice — Supabase 遷移 0001：雲端同步 op-log / LWW 狀態表
--
-- 對應本地 server/sync/db.mjs 的 SQLite schema（ops / entities），加上
-- `room` 欄位做多租戶隔離（room = SHA-256(SYNC_TOKEN) hex 前 16 字元）。
--
-- 語義保持：
--  - updated_at 維持 TEXT 字串（LWW 用字串比較，與客戶端 applyOps 一致；
--    不可改用 timestamptz，否則毫秒精度／字串比較語義會改變）。
--  - ops 的 seq 為 server 端單調遞增游標（identity），pull 游標一律用 seq。
--
-- RLS：兩表啟用 ROW LEVEL SECURITY 但不建任何 policy ——
--      anon / authenticated 一律無法存取；僅 service_role（bypasses RLS）
--      經 Edge Function 訪問。
-- ============================================================================

-- ─────────────────────────── ops 日誌（追加式）───────────────────────────
create table if not exists sync_ops (
  seq        bigint generated always as identity primary key,
  id         text   not null unique,
  room       text   not null,
  device_id  text   not null,
  tbl        text   not null,
  entity_id  text   not null,
  updated_at text   not null,
  type       text   not null check (type in ('put', 'del')),
  payload    jsonb  not null
);

-- pull 增量（room, seq > cursor）與依實體查詢用
create index if not exists sync_ops_room_seq_idx
  on sync_ops (room, seq);
create index if not exists sync_ops_room_tbl_entity_idx
  on sync_ops (room, tbl, entity_id);

-- ─────────────────────── entities 當前狀態（LWW）───────────────────────
create table if not exists sync_entities (
  room       text    not null,
  tbl        text    not null,
  entity_id  text    not null,
  updated_at text,
  payload    jsonb,
  deleted    boolean default false,
  device_id  text    default '',
  primary key (room, tbl, entity_id)
);

-- ─────────────────────────── 啟用 RLS（無 policy）───────────────────────
alter table sync_ops enable row level security;
alter table sync_entities enable row level security;

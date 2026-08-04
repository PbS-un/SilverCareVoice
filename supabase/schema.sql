-- ============================================================================
-- SilverCare Voice — Supabase DDL（T2 交付，僅供未來啟用 Supabase 時執行）
-- 18 張表，snake_case，與 web/src/types/entities.ts 一一對應。
-- 所有表含 id / created_at / updated_at（timestamptz）。
-- RLS：每張表啟用 ROW LEVEL SECURITY；policy 概念見各表註記
--     （角色：elder = 長者本人、caregiver = 獲授權照顧者、staff = 醫護/管理）。
-- ============================================================================

-- 共用：自動維護 updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────── 用戶與關係 ───────────────────────────────

create table users (
  id         text primary key,
  name       text not null,
  role       text not null check (role in ('elder', 'caregiver', 'staff')),
  phone      text,
  ref_id     text,            -- 對應 elder_profiles.id 或 caregivers.id
  language   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function set_updated_at();
-- RLS 概念：本人只能讀寫自己的 users 列。

create table elder_profiles (
  id                    text primary key,
  name                  text not null,
  age                   int  not null,
  chronic_condition_ids text[] not null default '{}',
  language              text not null default 'zh-HK',
  address               text,
  emergency_note        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger elder_profiles_updated before update on elder_profiles for each row execute function set_updated_at();
-- RLS 概念：elder 本人、透過 caregiver_links 授權之 caregiver、staff 可讀。

create table caregivers (
  id      text primary key,
  name    text not null,
  relation text not null,
  phone   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger caregivers_updated before update on caregivers for each row execute function set_updated_at();
-- RLS 概念：caregiver 本人可讀寫自己。

create table caregiver_links (
  id            text primary key,
  elder_id      text not null references elder_profiles(id) on delete cascade,
  caregiver_id  text not null references caregivers(id) on delete cascade,
  consent_given boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index caregiver_links_elder_id_idx on caregiver_links(elder_id);
create index caregiver_links_caregiver_id_idx on caregiver_links(caregiver_id);
create trigger caregiver_links_updated before update on caregiver_links for each row execute function set_updated_at();
-- RLS 概念：本表是 caregiver 讀取 elder 資料的授權依據；
--           caregiver 只能讀取 consent_given = true 且 caregiver_id = auth.uid() 的列。

-- ─────────────────────────────── 健康資料 ───────────────────────────────

create table chronic_conditions (
  id        text primary key,
  elder_id  text not null references elder_profiles(id) on delete cascade,
  name      text not null,
  type      text not null check (type in ('hypertension','diabetes','heart_disease','respiratory','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chronic_conditions_elder_id_idx on chronic_conditions(elder_id);
create trigger chronic_conditions_updated before update on chronic_conditions for each row execute function set_updated_at();
-- RLS 概念：同 elder_profiles（本人 / 授權 caregiver / staff）。

create table vital_records (
  id          text primary key,
  elder_id    text not null references elder_profiles(id) on delete cascade,
  type        text not null check (type in ('blood_pressure','blood_glucose','heart_rate','weight')),
  systolic    int,
  diastolic   int,
  value       numeric,
  unit        text not null,
  measured_at timestamptz not null,
  source      text not null check (source in ('voice','text','form','seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vital_records_elder_id_idx on vital_records(elder_id);
create index vital_records_measured_at_idx on vital_records(measured_at);
create trigger vital_records_updated before update on vital_records for each row execute function set_updated_at();
-- RLS 概念：elder 可讀寫自己；授權 caregiver 只讀；AssistantService 以 service role 寫入。

create table medications (
  id        text primary key,
  elder_id  text not null references elder_profiles(id) on delete cascade,
  name      text not null,
  dosage    text not null,
  schedule  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medications_elder_id_idx on medications(elder_id);
create trigger medications_updated before update on medications for each row execute function set_updated_at();
-- RLS 概念：同 vital_records。

create table medication_logs (
  id            text primary key,
  elder_id      text not null references elder_profiles(id) on delete cascade,
  medication_id text not null references medications(id) on delete cascade,
  scheduled_at  timestamptz not null,
  taken_at      timestamptz,
  status        text not null check (status in ('taken','missed','late','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medication_logs_elder_id_idx on medication_logs(elder_id);
create index medication_logs_medication_id_idx on medication_logs(medication_id);
create index medication_logs_scheduled_at_idx on medication_logs(scheduled_at);
create index medication_logs_status_idx on medication_logs(status);
create trigger medication_logs_updated before update on medication_logs for each row execute function set_updated_at();
-- RLS 概念：同 vital_records。

create table symptom_records (
  id          text primary key,
  elder_id    text not null references elder_profiles(id) on delete cascade,
  symptoms    text[] not null default '{}',
  description text not null,
  severity    text not null check (severity in ('mild','moderate','severe')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index symptom_records_elder_id_idx on symptom_records(elder_id);
create index symptom_records_occurred_at_idx on symptom_records(occurred_at);
create trigger symptom_records_updated before update on symptom_records for each row execute function set_updated_at();
-- RLS 概念：同 vital_records。

create table appointments (
  id       text primary key,
  elder_id text not null references elder_profiles(id) on delete cascade,
  date     timestamptz not null,
  location text not null,
  note     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_elder_id_idx on appointments(elder_id);
create index appointments_date_idx on appointments(date);
create trigger appointments_updated before update on appointments for each row execute function set_updated_at();
-- RLS 概念：同 vital_records。

create table health_events (
  id               text primary key,
  elder_id         text not null references elder_profiles(id) on delete cascade,
  type             text not null,
  severity         text not null check (severity in ('normal','attention','urgent')),
  summary          text not null,
  source_record_ids text[] not null default '{}',
  resolved_at      timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index health_events_elder_id_idx on health_events(elder_id);
create index health_events_severity_idx on health_events(severity);
create trigger health_events_updated before update on health_events for each row execute function set_updated_at();
-- RLS 概念：由規則/AI 引擎（service role）寫入；elder / 授權 caregiver / staff 可讀。

create table alerts (
  id             text primary key,
  elder_id       text not null references elder_profiles(id) on delete cascade,
  caregiver_id   text not null references caregivers(id) on delete cascade,
  health_event_id text not null references health_events(id) on delete cascade,
  severity       text not null check (severity in ('normal','attention','urgent')),
  message        text not null,
  status         text not null check (status in ('open','acknowledged','resolved')),
  seen_at        timestamptz,
  resolved_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index alerts_elder_id_idx on alerts(elder_id);
create index alerts_caregiver_id_idx on alerts(caregiver_id);
create index alerts_health_event_id_idx on alerts(health_event_id);
create index alerts_status_idx on alerts(status);
create trigger alerts_updated before update on alerts for each row execute function set_updated_at();
-- RLS 概念：caregiver 只能讀/更新 caregiver_id = 自己 的列；elder 只讀自己的。

create table caregiver_follow_ups (
  id           text primary key,
  alert_id     text not null references alerts(id) on delete cascade,
  caregiver_id text not null references caregivers(id) on delete cascade,
  type         text not null check (type in ('phone','message','visit','other')),
  note         text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index caregiver_follow_ups_alert_id_idx on caregiver_follow_ups(alert_id);
create index caregiver_follow_ups_caregiver_id_idx on caregiver_follow_ups(caregiver_id);
create trigger caregiver_follow_ups_updated before update on caregiver_follow_ups for each row execute function set_updated_at();
-- RLS 概念：caregiver 可讀寫自己的跟進；elder / staff 可讀。

-- ─────────────────────────────── 對話與服務 ───────────────────────────────

create table conversations (
  id       text primary key,
  elder_id text not null references elder_profiles(id) on delete cascade,
  role     text not null check (role in ('elder','assistant','system')),
  message  text not null,
  intent   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_elder_id_idx on conversations(elder_id);
create index conversations_created_at_idx on conversations(created_at);
create trigger conversations_updated before update on conversations for each row execute function set_updated_at();
-- RLS 概念：elder 只讀自己；AssistantService（service role）寫入。

create table service_queries (
  id          text primary key,
  elder_id    text not null references elder_profiles(id) on delete cascade,
  query       text not null,
  category    text not null,
  matched_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_queries_elder_id_idx on service_queries(elder_id);
create trigger service_queries_updated before update on service_queries for each row execute function set_updated_at();
-- RLS 概念：同 conversations。

create table consents (
  id       text primary key,
  elder_id text not null references elder_profiles(id) on delete cascade,
  type     text not null,
  granted  boolean not null,
  text     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consents_elder_id_idx on consents(elder_id);
create trigger consents_updated before update on consents for each row execute function set_updated_at();
-- RLS 概念：僅 elder 本人（或 staff）可讀寫；私隱合規核心表。

create table audit_logs (
  id          text primary key,
  actor       text not null,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  detail      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity_type, entity_id);
create trigger audit_logs_updated before update on audit_logs for each row execute function set_updated_at();
-- RLS 概念：唯讀審計表 —— 只允許 service role 插入，任何角色不可 update/delete。

-- ─────────────────────────────── 知識與資源 ───────────────────────────────

create table resource_directory (
  id       text primary key,
  name     text not null,
  category text not null,
  address  text not null,
  phone    text not null,
  hours    text not null,
  region   text not null check (region in ('澳門半島','氹仔','路環','全澳')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resource_directory_category_idx on resource_directory(category);
create index resource_directory_region_idx on resource_directory(region);
create trigger resource_directory_updated before update on resource_directory for each row execute function set_updated_at();
-- RLS 概念：公開目錄 —— 所有人可讀；僅 staff 可寫。

create table knowledge_documents (
  id          text primary key,
  title       text not null,
  category    text not null,
  summary     text not null,
  eligibility text,
  location    text,
  source      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_documents_category_idx on knowledge_documents(category);
create trigger knowledge_documents_updated before update on knowledge_documents for each row execute function set_updated_at();
-- RLS 概念：同 resource_directory（內容由 T9 知識庫任務導入）。

-- ─────────────────────────────── 啟用 RLS ───────────────────────────────
-- 概念：所有表一律啟用 RLS，未建立 policy 前 anon/authenticated 均無法存取；
--       正式 policy 需結合 auth.uid() 與 caregiver_links 授權判斷（後續任務實作）。

alter table users enable row level security;
alter table elder_profiles enable row level security;
alter table caregivers enable row level security;
alter table caregiver_links enable row level security;
alter table chronic_conditions enable row level security;
alter table vital_records enable row level security;
alter table medications enable row level security;
alter table medication_logs enable row level security;
alter table symptom_records enable row level security;
alter table appointments enable row level security;
alter table health_events enable row level security;
alter table alerts enable row level security;
alter table caregiver_follow_ups enable row level security;
alter table conversations enable row level security;
alter table service_queries enable row level security;
alter table consents enable row level security;
alter table audit_logs enable row level security;
alter table resource_directory enable row level security;
alter table knowledge_documents enable row level security;

-- ============================================================================
-- SilverCare Voice — Supabase Seed（陳婆婆 demo 資料）
-- 與 web/src/data/seed.ts 一一對應；ID 相同（'seed-*'）。
-- 時間相對「執行當下」動態生成（current_date - N），確保任何一天 demo 都合理。
-- 執行前須先執行 schema.sql。knowledge_documents 刻意留空（內容由 T9 導入）。
-- ============================================================================

-- ──────────────── 用戶 / 長者 / 照顧者 ────────────────

insert into users (id, name, role, phone, ref_id, language, created_at)
values
  ('seed-user-elder',     '陳婆婆', 'elder',     '+85362000001', 'seed-elder-01',    'zh-HK', current_date - 30),
  ('seed-user-caregiver', '阿美',   'caregiver', '+85362000002', 'seed-caregiver-01','zh-HK', current_date - 30);

insert into elder_profiles (id, name, age, chronic_condition_ids, language, address, emergency_note, created_at)
values ('seed-elder-01', '陳婆婆', 78, array['seed-cc-01','seed-cc-02'], 'zh-HK',
        '澳門黑沙環', '如血壓持續偏高請聯絡女兒阿美', current_date - 30);

insert into caregivers (id, name, relation, phone, created_at)
values ('seed-caregiver-01', '阿美', '女兒', '+85362000002', current_date - 30);

insert into caregiver_links (id, elder_id, caregiver_id, consent_given, created_at)
values ('seed-link-01', 'seed-elder-01', 'seed-caregiver-01', true, current_date - 30);

-- ──────────────── 慢病 / 藥物 ────────────────

insert into chronic_conditions (id, elder_id, name, type, created_at) values
  ('seed-cc-01', 'seed-elder-01', '高血壓', 'hypertension', current_date - 30),
  ('seed-cc-02', 'seed-elder-01', '糖尿病', 'diabetes',     current_date - 30);

insert into medications (id, elder_id, name, dosage, schedule, created_at) values
  ('seed-med-01', 'seed-elder-01', '降壓藥', '1 粒', '每天早上 8 時服用',             current_date - 30),
  ('seed-med-02', 'seed-elder-01', '降糖藥', '1 粒', '每日早晚各一次（8 時及 20 時）', current_date - 30);

-- ──────────────── 過去 6 日血壓（132/84 → 147/91） ────────────────

insert into vital_records (id, elder_id, type, systolic, diastolic, unit, measured_at, source, created_at) values
  ('seed-vr-bp-01', 'seed-elder-01', 'blood_pressure', 132, 84, 'mmHg', (current_date - 5 + time '08:10')::timestamptz, 'voice', (current_date - 5 + time '08:12')::timestamptz),
  ('seed-vr-bp-02', 'seed-elder-01', 'blood_pressure', 145, 90, 'mmHg', (current_date - 4 + time '08:10')::timestamptz, 'form',  (current_date - 4 + time '08:12')::timestamptz),
  ('seed-vr-bp-03', 'seed-elder-01', 'blood_pressure', 138, 86, 'mmHg', (current_date - 3 + time '08:10')::timestamptz, 'voice', (current_date - 3 + time '08:12')::timestamptz),
  ('seed-vr-bp-04', 'seed-elder-01', 'blood_pressure', 150, 93, 'mmHg', (current_date - 2 + time '08:10')::timestamptz, 'form',  (current_date - 2 + time '08:12')::timestamptz),
  ('seed-vr-bp-05', 'seed-elder-01', 'blood_pressure', 142, 88, 'mmHg', (current_date - 1 + time '08:10')::timestamptz, 'voice', (current_date - 1 + time '08:12')::timestamptz),
  ('seed-vr-bp-06', 'seed-elder-01', 'blood_pressure', 147, 91, 'mmHg', (current_date     + time '08:10')::timestamptz, 'form',  (current_date     + time '08:12')::timestamptz);

-- 血糖 / 心率 / 體重
insert into vital_records (id, elder_id, type, value, unit, measured_at, source, created_at) values
  ('seed-vr-glu-01', 'seed-elder-01', 'blood_glucose', 5.8, 'mmol/L', (current_date - 5 + time '07:45')::timestamptz, 'voice', (current_date - 5 + time '07:45')::timestamptz),
  ('seed-vr-glu-02', 'seed-elder-01', 'blood_glucose', 6.4, 'mmol/L', (current_date - 3 + time '07:50')::timestamptz, 'voice', (current_date - 3 + time '07:50')::timestamptz),
  ('seed-vr-glu-03', 'seed-elder-01', 'blood_glucose', 7.1, 'mmol/L', (current_date - 1 + time '07:48')::timestamptz, 'voice', (current_date - 1 + time '07:48')::timestamptz),
  ('seed-vr-glu-04', 'seed-elder-01', 'blood_glucose', 8.9, 'mmol/L', (current_date - 2 + time '14:30')::timestamptz, 'voice', (current_date - 2 + time '14:30')::timestamptz),
  ('seed-vr-hr-01',  'seed-elder-01', 'heart_rate', 72, 'bpm', (current_date - 5 + time '08:15')::timestamptz, 'form', (current_date - 5 + time '08:15')::timestamptz),
  ('seed-vr-hr-02',  'seed-elder-01', 'heart_rate', 76, 'bpm', (current_date - 3 + time '08:18')::timestamptz, 'form', (current_date - 3 + time '08:18')::timestamptz),
  ('seed-vr-hr-03',  'seed-elder-01', 'heart_rate', 74, 'bpm', (current_date - 1 + time '08:16')::timestamptz, 'form', (current_date - 1 + time '08:16')::timestamptz),
  ('seed-vr-wt-01',  'seed-elder-01', 'weight', 55.2, 'kg',   (current_date - 4 + time '08:20')::timestamptz, 'form', (current_date - 4 + time '08:21')::timestamptz);

-- ──────────────── 近 6 日服藥記錄（seed-ml-12 為唯一 missed） ────────────────
-- 排程：降壓藥 08:00；降糖藥 08:00 / 20:00。seq 依日期由舊到新。

insert into medication_logs (id, elder_id, medication_id, scheduled_at, taken_at, status, created_at) values
  ('seed-ml-01', 'seed-elder-01', 'seed-med-01', (current_date - 5 + time '08:00')::timestamptz, (current_date - 5 + time '08:10')::timestamptz, 'taken', (current_date - 5 + time '08:00')::timestamptz),
  ('seed-ml-02', 'seed-elder-01', 'seed-med-02', (current_date - 5 + time '08:00')::timestamptz, (current_date - 5 + time '08:10')::timestamptz, 'taken', (current_date - 5 + time '08:00')::timestamptz),
  ('seed-ml-03', 'seed-elder-01', 'seed-med-02', (current_date - 5 + time '20:00')::timestamptz, (current_date - 5 + time '20:10')::timestamptz, 'taken', (current_date - 5 + time '20:00')::timestamptz),
  ('seed-ml-04', 'seed-elder-01', 'seed-med-01', (current_date - 4 + time '08:00')::timestamptz, (current_date - 4 + time '08:10')::timestamptz, 'taken', (current_date - 4 + time '08:00')::timestamptz),
  ('seed-ml-05', 'seed-elder-01', 'seed-med-02', (current_date - 4 + time '08:00')::timestamptz, (current_date - 4 + time '08:10')::timestamptz, 'taken', (current_date - 4 + time '08:00')::timestamptz),
  ('seed-ml-06', 'seed-elder-01', 'seed-med-02', (current_date - 4 + time '20:00')::timestamptz, (current_date - 4 + time '20:10')::timestamptz, 'taken', (current_date - 4 + time '20:00')::timestamptz),
  ('seed-ml-07', 'seed-elder-01', 'seed-med-01', (current_date - 3 + time '08:00')::timestamptz, (current_date - 3 + time '08:10')::timestamptz, 'taken', (current_date - 3 + time '08:00')::timestamptz),
  ('seed-ml-08', 'seed-elder-01', 'seed-med-02', (current_date - 3 + time '08:00')::timestamptz, (current_date - 3 + time '08:10')::timestamptz, 'taken', (current_date - 3 + time '08:00')::timestamptz),
  ('seed-ml-09', 'seed-elder-01', 'seed-med-02', (current_date - 3 + time '20:00')::timestamptz, (current_date - 3 + time '20:10')::timestamptz, 'taken', (current_date - 3 + time '20:00')::timestamptz),
  ('seed-ml-10', 'seed-elder-01', 'seed-med-01', (current_date - 2 + time '08:00')::timestamptz, (current_date - 2 + time '08:10')::timestamptz, 'taken', (current_date - 2 + time '08:00')::timestamptz),
  ('seed-ml-11', 'seed-elder-01', 'seed-med-02', (current_date - 2 + time '08:00')::timestamptz, (current_date - 2 + time '08:10')::timestamptz, 'taken', (current_date - 2 + time '08:00')::timestamptz),
  ('seed-ml-12', 'seed-elder-01', 'seed-med-02', (current_date - 2 + time '20:00')::timestamptz, null, 'missed', (current_date - 2 + time '20:00')::timestamptz),
  ('seed-ml-13', 'seed-elder-01', 'seed-med-01', (current_date - 1 + time '08:00')::timestamptz, (current_date - 1 + time '08:10')::timestamptz, 'taken', (current_date - 1 + time '08:00')::timestamptz),
  ('seed-ml-14', 'seed-elder-01', 'seed-med-02', (current_date - 1 + time '08:00')::timestamptz, (current_date - 1 + time '08:10')::timestamptz, 'taken', (current_date - 1 + time '08:00')::timestamptz),
  ('seed-ml-15', 'seed-elder-01', 'seed-med-02', (current_date - 1 + time '20:00')::timestamptz, (current_date - 1 + time '20:10')::timestamptz, 'taken', (current_date - 1 + time '20:00')::timestamptz),
  ('seed-ml-16', 'seed-elder-01', 'seed-med-01', (current_date + time '08:00')::timestamptz, (current_date + time '08:10')::timestamptz, 'taken', (current_date + time '08:00')::timestamptz),
  ('seed-ml-17', 'seed-elder-01', 'seed-med-02', (current_date + time '08:00')::timestamptz, (current_date + time '08:10')::timestamptz, 'taken', (current_date + time '08:00')::timestamptz),
  ('seed-ml-18', 'seed-elder-01', 'seed-med-02', (current_date + time '20:00')::timestamptz, null, 'pending', (current_date + time '20:00')::timestamptz);

-- ──────────────── 症狀 / 覆診 ────────────────

insert into symptom_records (id, elder_id, symptoms, description, severity, occurred_at, created_at) values
  ('seed-sym-01', 'seed-elder-01', array['頭暈'],
   '輕微頭暈，坐低休息後好啲，無其他不適。', 'mild',
   (current_date - 1 + time '15:30')::timestamptz, (current_date - 1 + time '15:35')::timestamptz);

insert into appointments (id, elder_id, date, location, note, created_at) values
  ('seed-appt-01', 'seed-elder-01', (current_date + 14 + time '09:30')::timestamptz,
   '仁伯爵綜合醫院', '內科覆診（血壓及血糖跟進），記得帶覆診卡同藥物清單。', current_date - 10);

-- ──────────────── 既往健康事件 / 提醒 / 跟進 ────────────────

insert into health_events (id, elder_id, type, severity, summary, source_record_ids, resolved_at, created_at) values
  ('seed-he-01', 'seed-elder-01', 'bp_spike', 'attention',
   '血壓升至 150/93 mmHg，較近期水平偏高，建議留意並聯絡長者。',
   array['seed-vr-bp-04'], (current_date - 2 + time '10:30')::timestamptz,
   (current_date - 2 + time '08:15')::timestamptz);

insert into alerts (id, elder_id, caregiver_id, health_event_id, severity, message, status, seen_at, resolved_at, created_at) values
  ('seed-alert-01', 'seed-elder-01', 'seed-caregiver-01', 'seed-he-01', 'attention',
   '陳婆婆今朝血壓 150/93 mmHg，比平日偏高，建議打電話關心一下。', 'resolved',
   (current_date - 2 + time '08:40')::timestamptz, (current_date - 2 + time '10:30')::timestamptz,
   (current_date - 2 + time '08:20')::timestamptz);

insert into caregiver_follow_ups (id, alert_id, caregiver_id, type, note, created_at) values
  ('seed-fu-01', 'seed-alert-01', 'seed-caregiver-01', 'phone',
   '打咗電話同媽咪傾咗，佢話無事，只係昨晚瞓得唔好。已叮佢記得食藥。',
   (current_date - 2 + time '10:25')::timestamptz);

-- ──────────────── 對話 / 服務查詢 / 同意 / 審計 ────────────────

insert into conversations (id, elder_id, role, message, intent, created_at) values
  ('seed-conv-01', 'seed-elder-01', 'elder',     '我今日食咗降壓藥未呀？', 'medication_query',  (current_date + time '09:15')::timestamptz),
  ('seed-conv-02', 'seed-elder-01', 'assistant', '陳婆婆，你今朝 8 點 10 分已經食咗降壓藥喇，唔使擔心。', null, (current_date + time '09:15')::timestamptz),
  ('seed-conv-03', 'seed-elder-01', 'elder',     '幫我看下覆診係幾時？', 'appointment_query', (current_date - 1 + time '10:00')::timestamptz),
  ('seed-conv-04', 'seed-elder-01', 'assistant', '你兩星期後朝早 9 點半喺仁伯爵綜合醫院有內科覆診，記得帶覆診卡呀。', null, (current_date - 1 + time '10:00')::timestamptz),
  ('seed-conv-05', 'seed-elder-01', 'elder',     '我琴晚覺得有少少頭暈。', 'symptom_report', (current_date - 1 + time '15:30')::timestamptz);

insert into service_queries (id, elder_id, query, category, matched_ids, created_at) values
  ('seed-sq-01', 'seed-elder-01', '邊度可以量血壓？', '醫療服務',
   array['seed-res-03','seed-res-04'], (current_date - 2 + time '16:00')::timestamptz);

insert into consents (id, elder_id, type, granted, text, created_at) values
  ('seed-consent-01', 'seed-elder-01', 'caregiver_data_sharing', true,
   '本人同意將健康記錄摘要分享俾照顧者（女兒阿美），以便照顧同跟進。', current_date - 30);

insert into audit_logs (id, actor, action, entity_type, entity_id, detail, created_at) values
  ('seed-audit-01', 'system',             'seed.load',     'all',     '-',                 '載入陳婆婆 demo 種子資料', now()),
  ('seed-audit-02', 'seed-user-elder',    'consent.grant', 'Consent', 'seed-consent-01',   '長者同意向照顧者分享健康摘要', current_date - 30),
  ('seed-audit-03', 'seed-user-caregiver','alert.resolve', 'Alert',   'seed-alert-01',     '照顧者確認跟進完成', current_date - 2);

-- ──────────────── 澳門醫療資源（電話為公開常見值，僅供演示，上線前需核實） ────────────────

insert into resource_directory (id, name, category, address, phone, hours, region, created_at) values
  ('seed-res-01', '仁伯爵綜合醫院（山頂醫院）', '公立醫院', '澳門若憲馬路',                 '28313731', '急診 24 小時', '澳門半島', current_date - 60),
  ('seed-res-02', '鏡湖醫院',                   '私立醫院', '澳門連勝街',                   '28371333', '急診 24 小時', '澳門半島', current_date - 60),
  ('seed-res-03', '黑沙環衛生中心',             '衛生中心', '澳門黑沙環馬路',               '28481868', '週一至週五 09:00-13:00 / 14:30-17:45', '澳門半島', current_date - 60),
  ('seed-res-04', '筷子基衛生中心',             '衛生中心', '澳門筷子基社屋快達樓',         '28221049', '週一至週五 09:00-13:00 / 14:30-17:45', '澳門半島', current_date - 60),
  ('seed-res-05', '氹仔衛生中心',               '衛生中心', '氹仔布拉干薩街',               '28827133', '週一至週五 09:00-13:00 / 14:30-17:45', '氹仔',     current_date - 60),
  ('seed-res-06', '澳門鏡湖護理學院社區健康服務', '社區護理', '澳門馬六甲街',                 '28371333', '週一至週五 09:00-17:30', '澳門半島', current_date - 60);

-- knowledge_documents 刻意留空：知識庫內容由 T9 任務導入，本任務不代寫。

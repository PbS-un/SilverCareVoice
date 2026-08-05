/**
 * SilverCare Voice — 資料層實體定義（T2）
 *
 * 19 個核心實體，全部包含 `id` / `createdAt` / `updatedAt`（ISO-8601 string）。
 * 運行時 ID 一律用 crypto.randomUUID()；seed 資料用穩定前綴 ID（'seed-*'）。
 * 與 supabase/schema.sql（snake_case）一一對應。
 */

/** 所有實體共同的基礎欄位。 */
export interface BaseEntity {
  /** 主鍵。運行時用 crypto.randomUUID()，seed 用 'seed-*' 穩定 ID。 */
  id: string;
  /** 建立時間（ISO-8601 UTC string）。 */
  createdAt: string;
  /** 最後更新時間（ISO-8601 UTC string），由 DataProvider.put 自動維護。 */
  updatedAt: string;
}

/* ────────────────────────────── 用戶與關係 ────────────────────────────── */

/** 系統用戶（登入身份）。 */
export interface User extends BaseEntity {
  name: string;
  role: 'elder' | 'caregiver' | 'staff';
  phone?: string;
  /** 對應的長者或照顧者實體 ID。 */
  refId?: string;
  language?: 'zh-HK' | 'zh-TW' | 'en';
}

/** 長者檔案。 */
export interface ElderProfile extends BaseEntity {
  name: string;
  age: number;
  /** 慢病 ID 列表（指向 ChronicCondition.id）。 */
  chronicConditionIds: string[];
  language: 'zh-HK';
  address?: string;
  emergencyNote?: string;
}

/** 照顧者（家人）。 */
export interface Caregiver extends BaseEntity {
  name: string;
  relation: string;
  phone: string;
}

/** 長者 ↔ 照顧者授權關係（含長者同意）。 */
export interface CaregiverLink extends BaseEntity {
  elderId: string;
  caregiverId: string;
  consentGiven: boolean;
}

/* ────────────────────────────── 健康資料 ────────────────────────────── */

/** 長者慢病。 */
export interface ChronicCondition extends BaseEntity {
  elderId: string;
  name: string;
  type: 'hypertension' | 'diabetes' | 'heart_disease' | 'respiratory' | 'other';
}

export type VitalType = 'blood_pressure' | 'blood_glucose' | 'heart_rate' | 'weight';
export type VitalSource = 'voice' | 'text' | 'form' | 'seed';

/** 生命徵象記錄。血壓用 systolic/diastolic；其餘用 value。 */
export interface VitalRecord extends BaseEntity {
  elderId: string;
  type: VitalType;
  systolic?: number;
  diastolic?: number;
  value?: number;
  unit: string;
  measuredAt: string;
  source: VitalSource;
}

/** 藥物。 */
export interface Medication extends BaseEntity {
  elderId: string;
  name: string;
  dosage: string;
  /** 人類可讀的服藥時間描述，如「每天早上 8 時」。 */
  schedule: string;
  /**
   * 劑量數值（結構化，如 1、30）。
   * 向後兼容：舊數據無此欄位（undefined），同步 payload 透明帶過；
   * dosage 字串仍是唯一真相來源，此欄位僅供 UI 拆分／重組顯示。
   */
  doseAmount?: number;
  /**
   * 劑量單位（DOSE_UNITS 之一，如「粒」「毫克 mg」）。
   * 向後兼容：舊數據無此欄位（undefined），同步 payload 透明帶過。
   */
  doseUnit?: string;
}

/** 服藥記錄。 */
export interface MedicationLog extends BaseEntity {
  elderId: string;
  medicationId: string;
  scheduledAt: string;
  takenAt?: string;
  status: 'taken' | 'missed' | 'late' | 'pending';
}

/** 症狀記錄（長者口述）。 */
export interface SymptomRecord extends BaseEntity {
  elderId: string;
  symptoms: string[];
  description: string;
  severity: 'mild' | 'moderate' | 'severe';
  occurredAt: string;
}

/** 覆診／預約。 */
export interface Appointment extends BaseEntity {
  elderId: string;
  date: string;
  location: string;
  note?: string;
  /**
   * 時間未定標記：true 時 date 僅代表日期（甚至可為遠期佔位），
   * UI 顯示「時間未定」而非 HH:mm。
   * 向後兼容：舊數據無此欄位（undefined），視同 false；
   * 同步 payload 透明帶過，不影響既有 fmtDate 邏輯。
   */
  timeTbd?: boolean;
  /** 專科（如「內科」「眼科」）。向後兼容：舊數據無此欄位。 */
  specialty?: string;
  /** 主診醫生姓名。向後兼容：舊數據無此欄位。 */
  doctor?: string;
}

/** 系統偵測到的健康事件（規則／AI 推論結果）。 */
export interface HealthEvent extends BaseEntity {
  elderId: string;
  type: string;
  severity: 'normal' | 'attention' | 'urgent';
  summary: string;
  /** 來源記錄 ID（VitalRecord / SymptomRecord / MedicationLog 等）。 */
  sourceRecordIds: string[];
  resolvedAt?: string;
}

/** 對照顧者的提醒。 */
export interface Alert extends BaseEntity {
  elderId: string;
  caregiverId: string;
  healthEventId: string;
  severity: 'normal' | 'attention' | 'urgent';
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  seenAt?: string;
  resolvedAt?: string;
}

/** 照顧者跟進記錄。 */
export interface CaregiverFollowUp extends BaseEntity {
  alertId: string;
  caregiverId: string;
  type: 'phone' | 'message' | 'visit' | 'other';
  note: string;
}

/* ────────────────────────────── 對話與服務 ────────────────────────────── */

/** 對話訊息。 */
export interface Conversation extends BaseEntity {
  elderId: string;
  role: 'elder' | 'assistant' | 'system';
  message: string;
  intent?: string;
}

/** 服務查詢（問機構／資源）及匹配結果。 */
export interface ServiceQuery extends BaseEntity {
  elderId: string;
  query: string;
  category: string;
  matchedIds: string[];
}

/** 同意記錄（私隱合規）。 */
export interface Consent extends BaseEntity {
  elderId: string;
  type: string;
  granted: boolean;
  text: string;
}

/** 審計日誌。 */
export interface AuditLog extends BaseEntity {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: string;
}

/* ────────────────────────────── 知識與資源 ────────────────────────────── */

/** 澳門社區醫療資源目錄。 */
export interface ResourceDirectory extends BaseEntity {
  name: string;
  category: string;
  address: string;
  phone: string;
  hours: string;
  region: '澳門半島' | '氹仔' | '路環' | '全澳';
}

/** 知識庫文件（由 T9 任務導入，T2 不代寫內容）。 */
export interface KnowledgeDocument extends BaseEntity {
  title: string;
  category: string;
  summary: string;
  eligibility?: string;
  location?: string;
  source: string;
}

/* ────────────────────────────── 名稱與表映射 ────────────────────────────── */

/** 實體名稱 union。 */
export type EntityName =
  | 'User'
  | 'ElderProfile'
  | 'Caregiver'
  | 'CaregiverLink'
  | 'ChronicCondition'
  | 'VitalRecord'
  | 'Medication'
  | 'MedicationLog'
  | 'SymptomRecord'
  | 'Appointment'
  | 'HealthEvent'
  | 'Alert'
  | 'CaregiverFollowUp'
  | 'Conversation'
  | 'ServiceQuery'
  | 'Consent'
  | 'AuditLog'
  | 'ResourceDirectory'
  | 'KnowledgeDocument';

/** 實體 → 儲存表名稱（Dexie store 名）。 */
export const TABLE_NAMES: Record<EntityName, string> = {
  User: 'users',
  ElderProfile: 'elderProfiles',
  Caregiver: 'caregivers',
  CaregiverLink: 'caregiverLinks',
  ChronicCondition: 'chronicConditions',
  VitalRecord: 'vitalRecords',
  Medication: 'medications',
  MedicationLog: 'medicationLogs',
  SymptomRecord: 'symptomRecords',
  Appointment: 'appointments',
  HealthEvent: 'healthEvents',
  Alert: 'alerts',
  CaregiverFollowUp: 'caregiverFollowUps',
  Conversation: 'conversations',
  ServiceQuery: 'serviceQueries',
  Consent: 'consents',
  AuditLog: 'auditLogs',
  ResourceDirectory: 'resourceDirectory',
  KnowledgeDocument: 'knowledgeDocuments',
} as const;

/** 全部表名常量列表（迭代／reset 用）。 */
export const TABLE_NAME_LIST = Object.values(TABLE_NAMES) as TableName[];

/** 表名 union（DataProvider 各方法接受的 table 參數）。 */
export type TableName = (typeof TABLE_NAMES)[EntityName];

/** 實體名 → 實體型別映射。 */
export interface EntityMap {
  User: User;
  ElderProfile: ElderProfile;
  Caregiver: Caregiver;
  CaregiverLink: CaregiverLink;
  ChronicCondition: ChronicCondition;
  VitalRecord: VitalRecord;
  Medication: Medication;
  MedicationLog: MedicationLog;
  SymptomRecord: SymptomRecord;
  Appointment: Appointment;
  HealthEvent: HealthEvent;
  Alert: Alert;
  CaregiverFollowUp: CaregiverFollowUp;
  Conversation: Conversation;
  ServiceQuery: ServiceQuery;
  Consent: Consent;
  AuditLog: AuditLog;
  ResourceDirectory: ResourceDirectory;
  KnowledgeDocument: KnowledgeDocument;
}

/** 由實體名取表名的型別安全 helper。 */
export function tableNameOf(name: EntityName): TableName {
  return TABLE_NAMES[name] as TableName;
}

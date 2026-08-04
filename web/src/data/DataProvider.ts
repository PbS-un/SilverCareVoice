/**
 * SilverCare Voice — 資料層統一接口（T2）
 *
 * 所有讀寫一律經過 DataProvider（目前實作為 IndexedDBProvider / Dexie）。
 * UI、AssistantService 絕不直接觸碰 Dexie，未來可無縫切換到
 * SupabaseProvider（同步）——切換點只在 getProvider()。
 *
 * 注意：本檔案不載入任何 API Key / 機密。
 */

import type {
  BaseEntity,
  TableName,
  VitalRecord,
  VitalType,
  User,
  ElderProfile,
  Caregiver,
  CaregiverLink,
  ChronicCondition,
  Medication,
  MedicationLog,
  SymptomRecord,
  Appointment,
  HealthEvent,
  Alert,
  CaregiverFollowUp,
  Conversation,
  ServiceQuery,
  Consent,
  AuditLog,
  ResourceDirectory,
  KnowledgeDocument,
} from '../types/entities';
import { IndexedDBProvider } from './IndexedDBProvider';
import { SyncedProvider, type SyncMode } from './sync/outbox';
// SupabaseProvider 為 stub，未配置時不啟用（啟用條件見該檔案註釋）。
// import { SupabaseProvider } from './SupabaseProvider';

/** 一次 reset / 匯入用的完整種子資料結構（每張表一個陣列）。 */
export interface SeedData {
  users: User[];
  elderProfiles: ElderProfile[];
  caregivers: Caregiver[];
  caregiverLinks: CaregiverLink[];
  chronicConditions: ChronicCondition[];
  vitalRecords: VitalRecord[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  symptomRecords: SymptomRecord[];
  appointments: Appointment[];
  healthEvents: HealthEvent[];
  alerts: Alert[];
  caregiverFollowUps: CaregiverFollowUp[];
  conversations: Conversation[];
  serviceQueries: ServiceQuery[];
  consents: Consent[];
  auditLogs: AuditLog[];
  resourceDirectory: ResourceDirectory[];
  knowledgeDocuments: KnowledgeDocument[];
}

/** bulkPut 用的跨表項目。 */
export interface BulkEntry {
  table: TableName;
  entity: BaseEntity;
}

/** 訂閱回調：收到變更的表名。回傳 unsubscribe。 */
export type SubscribeCallback = (table: TableName) => void;
export type Unsubscribe = () => void;

/** list() 的過濾條件：欄位淺層相等比對。 */
export type ListFilter<T> = Partial<Record<keyof T, unknown>>;

export interface DataProvider {
  /** 列出表中全部（或符合 filter 的）記錄。 */
  list<T extends BaseEntity>(table: TableName, filter?: ListFilter<T>): Promise<T[]>;
  /** 依主鍵取單筆；不存在時回傳 undefined。 */
  get<T extends BaseEntity>(table: TableName, id: string): Promise<T | undefined>;
  /** 寫入／更新單筆。自動維護 updatedAt（新建時補 createdAt）。 */
  put<T extends BaseEntity>(table: TableName, entity: T): Promise<T>;
  /** 批次寫入（可跨表）。供 reset / seed / 匯入使用。 */
  bulkPut(entries: BulkEntry[]): Promise<void>;
  /** 刪除單筆。 */
  remove(table: TableName, id: string): Promise<void>;
  /** 查詢 helper：某長者某類生命徵數在時間範圍 [from, to] 內的記錄（依 measuredAt 排序）。 */
  vitalsBetween(elderId: string, type: VitalType, from: string, to: string): Promise<VitalRecord[]>;
  /**
   * 重置：清空全部 18 張表；提供 seed 時寫入種子資料。
   * Demo 重置與正式資料路徑完全一致（同一 repository，無 demo-only 分支）。
   */
  reset(seed?: SeedData): Promise<void>;
  /** 選填：訂閱寫入事件（UI 局部刷新用）。回傳 unsubscribe。 */
  subscribe?(cb: SubscribeCallback): Unsubscribe;
}

let providerSingleton: SyncedProvider | null = null;

/**
 * 執行時工廠：回傳 SyncedProvider（包裝 IndexedDBProvider，local-first）。
 *
 * T8 同步接入（上層完全無感）：首次取用時於背景探測 sync server
 * （GET /api/health，~2s 超時）。可達 → 啟用雙裝置同步（bootstrap/pull +
 * WS + Outbox）；不可達 → 維持 standalone（純 IndexedDB）。探測絕不阻塞
 * App，亦無任何 build flag / demo-only 分支。
 *
 * 注意：本檔案絕不讀取任何密鑰值；前端只用 anon key（見 .env.example）。
 */
export function getProvider(): DataProvider {
  if (!providerSingleton) {
    providerSingleton = new SyncedProvider(new IndexedDBProvider());
    // 測試環境（vitest）不自動探測，改由測試以 enableSync() 顯式控制。
    if (typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
      void providerSingleton.enableSync().catch(() => {
        /* 永不發生：enableSync 內部已全量 catch */
      });
    }
  }
  return providerSingleton;
}

/**
 * 顯式啟用同步（冪等）。回傳 'sync'（server 可達）或 'standalone'。
 * getProvider() 已自動呼叫；此匯出供需要等待結果的場景（如診斷 UI）使用。
 */
export function enableSync(): Promise<SyncMode> {
  const p = getProvider() as SyncedProvider;
  return p.enableSync();
}

/** 測試專用：重置 singleton（生產代碼不要使用）。 */
export function __resetProviderForTest(): void {
  providerSingleton = null;
}

/**
 * SilverCare Voice — IndexedDB (Dexie) 實作的 DataProvider（T2）
 *
 * DB 名稱：'silvercare-db'，version 1。
 * 每實體一張表（18 張）；索引只建在實際查詢路徑上
 * （elderId、measuredAt、status、createdAt、scheduledAt、occurredAt 等）。
 * put() 自動維護 updatedAt；reset() = 刪全表後 bulkPut seed。
 */

import Dexie, { type Table } from 'dexie';
import {
  TABLE_NAME_LIST,
  type BaseEntity,
  type TableName,
  type VitalRecord,
  type VitalType,
} from '../types/entities';
import type {
  BulkEntry,
  DataProvider,
  ListFilter,
  SeedData,
  SubscribeCallback,
  Unsubscribe,
} from './DataProvider';

function isoNow(): string {
  return new Date().toISOString();
}

/** SeedData 鍵 → 表名，供 reset() 批次寫入。 */
const SEED_KEY_TO_TABLE = {
  users: 'users',
  elderProfiles: 'elderProfiles',
  caregivers: 'caregivers',
  caregiverLinks: 'caregiverLinks',
  chronicConditions: 'chronicConditions',
  vitalRecords: 'vitalRecords',
  medications: 'medications',
  medicationLogs: 'medicationLogs',
  symptomRecords: 'symptomRecords',
  appointments: 'appointments',
  healthEvents: 'healthEvents',
  alerts: 'alerts',
  caregiverFollowUps: 'caregiverFollowUps',
  conversations: 'conversations',
  serviceQueries: 'serviceQueries',
  consents: 'consents',
  auditLogs: 'auditLogs',
  resourceDirectory: 'resourceDirectory',
  knowledgeDocuments: 'knowledgeDocuments',
} as const satisfies Record<keyof SeedData, TableName>;

class SilverCareDB extends Dexie {
  users!: Table<BaseEntity, string>;
  elderProfiles!: Table<BaseEntity, string>;
  caregivers!: Table<BaseEntity, string>;
  caregiverLinks!: Table<BaseEntity, string>;
  chronicConditions!: Table<BaseEntity, string>;
  vitalRecords!: Table<VitalRecord, string>;
  medications!: Table<BaseEntity, string>;
  medicationLogs!: Table<BaseEntity, string>;
  symptomRecords!: Table<BaseEntity, string>;
  appointments!: Table<BaseEntity, string>;
  healthEvents!: Table<BaseEntity, string>;
  alerts!: Table<BaseEntity, string>;
  caregiverFollowUps!: Table<BaseEntity, string>;
  conversations!: Table<BaseEntity, string>;
  serviceQueries!: Table<BaseEntity, string>;
  consents!: Table<BaseEntity, string>;
  auditLogs!: Table<BaseEntity, string>;
  resourceDirectory!: Table<BaseEntity, string>;
  knowledgeDocuments!: Table<BaseEntity, string>;

  constructor(dbName = 'silvercare-db') {
    super(dbName);
    this.version(1).stores({
      // 索引只建查詢路徑：elderId / measuredAt / status / createdAt 等
      users: 'id, createdAt, role',
      elderProfiles: 'id, name',
      caregivers: 'id, name',
      caregiverLinks: 'id, elderId, caregiverId',
      chronicConditions: 'id, elderId',
      vitalRecords: 'id, elderId, measuredAt, type, source',
      medications: 'id, elderId',
      medicationLogs: 'id, elderId, medicationId, scheduledAt, status',
      symptomRecords: 'id, elderId, occurredAt',
      appointments: 'id, elderId, date',
      healthEvents: 'id, elderId, severity, createdAt',
      alerts: 'id, elderId, caregiverId, healthEventId, status',
      caregiverFollowUps: 'id, alertId, caregiverId',
      conversations: 'id, elderId, createdAt',
      serviceQueries: 'id, elderId, createdAt',
      consents: 'id, elderId, type',
      auditLogs: 'id, entityType, entityId, createdAt',
      resourceDirectory: 'id, category, region',
      knowledgeDocuments: 'id, category, updatedAt',
    });
  }
}

export class IndexedDBProvider implements DataProvider {
  private db: SilverCareDB;
  private subscribers = new Set<SubscribeCallback>();

  constructor(dbName = 'silvercare-db') {
    this.db = new SilverCareDB(dbName);
  }

  private table(table: TableName): Table<BaseEntity, string> {
    return this.db.table(table) as Table<BaseEntity, string>;
  }

  private emit(table: TableName): void {
    for (const cb of this.subscribers) {
      try {
        cb(table);
      } catch {
        // 訂閱者錯誤不影響寫入流程
      }
    }
  }

  async list<T extends BaseEntity>(table: TableName, filter?: ListFilter<T>): Promise<T[]> {
    const all = (await this.table(table).toArray()) as T[];
    if (!filter) return all;
    const keys = Object.keys(filter) as (keyof T)[];
    return all.filter((row) => keys.every((k) => row[k] === filter[k]));
  }

  async get<T extends BaseEntity>(table: TableName, id: string): Promise<T | undefined> {
    return (await this.table(table).get(id)) as T | undefined;
  }

  async put<T extends BaseEntity>(table: TableName, entity: T): Promise<T> {
    if (!entity.id) throw new Error(`put(${table}): entity.id 不能為空（運行時請用 crypto.randomUUID()）`);
    const now = isoNow();
    const existing = await this.table(table).get(entity.id);
    const record: T = {
      ...entity,
      createdAt: existing?.createdAt || entity.createdAt || now,
      updatedAt: now,
    };
    await this.table(table).put(record as BaseEntity);
    this.emit(table);
    return record;
  }

  async bulkPut(entries: BulkEntry[]): Promise<void> {
    const now = isoNow();
    const byTable = new Map<TableName, BaseEntity[]>();
    for (const { table, entity } of entries) {
      const record: BaseEntity = {
        ...entity,
        createdAt: entity.createdAt ?? now,
        updatedAt: entity.updatedAt ?? now,
      };
      const arr = byTable.get(table) ?? [];
      arr.push(record);
      byTable.set(table, arr);
    }
    for (const [table, rows] of byTable) {
      if (rows.length > 0) {
        await this.table(table).bulkPut(rows);
        this.emit(table);
      }
    }
  }

  async remove(table: TableName, id: string): Promise<void> {
    await this.table(table).delete(id);
    this.emit(table);
  }

  async vitalsBetween(elderId: string, type: VitalType, from: string, to: string): Promise<VitalRecord[]> {
    const rows = await this.db.vitalRecords
      .where('elderId')
      .equals(elderId)
      .filter((r) => r.type === type && r.measuredAt >= from && r.measuredAt <= to)
      .toArray();
    return rows.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  }

  async reset(seed?: SeedData): Promise<void> {
    await Promise.all(TABLE_NAME_LIST.map((t) => this.table(t).clear()));
    if (seed) {
      const entries: BulkEntry[] = [];
      for (const key of Object.keys(SEED_KEY_TO_TABLE) as (keyof SeedData)[]) {
        const table = SEED_KEY_TO_TABLE[key];
        for (const entity of seed[key]) {
          entries.push({ table, entity });
        }
      }
      await this.bulkPut(entries);
    }
    for (const t of TABLE_NAME_LIST) this.emit(t);
  }

  subscribe(cb: SubscribeCallback): Unsubscribe {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** 關閉資料庫（測試／卸載用）。 */
  close(): void {
    this.db.close();
  }
}

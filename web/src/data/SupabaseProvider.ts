/**
 * SilverCare Voice — Supabase Provider（stub）（T2）
 *
 * 實作與 IndexedDBProvider 相同的 DataProvider 接口，但目前所有方法
 * 一律拋出 'Supabase not configured' —— 未配置前絕不允許誤用。
 *
 * ── 啟用條件（未來任務，本任務不接 runtime）──
 * 1. 建立 Supabase project，執行 supabase/schema.sql（18 表 + RLS 概念）。
 * 2. 執行 supabase/seed.sql（與 web/src/data/seed.ts 內容對應）。
 * 3. 在前端環境設定（.env）提供：
 *      VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *    （對應 supabase/.env.example；只可用 anon key，
 *      service role key 屬機密，嚴禁進入前端代碼。）
 * 4. 在本檔案安裝 @supabase/supabase-js，實作各方法，
 *    並在 DataProvider.getProvider() 切換回傳本 provider。
 *
 * 注意：本檔案目前不 import 任何 Supabase SDK、不讀取任何 Key。
 */

import type {
  BaseEntity,
  TableName,
  VitalRecord,
  VitalType,
} from '../types/entities';
import type {
  BulkEntry,
  DataProvider,
  ListFilter,
  SeedData,
  SubscribeCallback,
  Unsubscribe,
} from './DataProvider';

const NOT_CONFIGURED = 'Supabase not configured';

export class SupabaseProvider implements DataProvider {
  private fail(): never {
    throw new Error(NOT_CONFIGURED);
  }

  list<T extends BaseEntity>(_table: TableName, _filter?: ListFilter<T>): Promise<T[]> {
    return this.fail();
  }

  get<T extends BaseEntity>(_table: TableName, _id: string): Promise<T | undefined> {
    return this.fail();
  }

  put<T extends BaseEntity>(_table: TableName, _entity: T): Promise<T> {
    return this.fail();
  }

  bulkPut(_entries: BulkEntry[]): Promise<void> {
    return this.fail();
  }

  remove(_table: TableName, _id: string): Promise<void> {
    return this.fail();
  }

  vitalsBetween(
    _elderId: string,
    _type: VitalType,
    _from: string,
    _to: string,
  ): Promise<VitalRecord[]> {
    return this.fail();
  }

  reset(_seed?: SeedData): Promise<void> {
    return this.fail();
  }

  subscribe(_cb: SubscribeCallback): Unsubscribe {
    return this.fail();
  }
}

/**
 * shouldSeedDemoData：空庫／舊版單長者 seed／雲端舊資料 → 需要重灌 100 名合成長者。
 */
import { describe, expect, it } from 'vitest';

import { shouldSeedDemoData } from '../demoReset';
import type { ElderProfile, User } from '../../types/entities';

function elder(id: string): ElderProfile {
  return {
    id,
    name: '測試長者',
    age: 78,
    chronicConditionIds: [],
    language: 'zh-HK',
    createdAt: '',
    updatedAt: '',
  };
}

function user(id: string, role: User['role'], refId: string, accountCode?: string): User {
  return {
    id,
    name: '測試',
    role,
    refId,
    accountCode,
    createdAt: '',
    updatedAt: '',
  };
}

describe('shouldSeedDemoData', () => {
  it('空庫 → true', () => {
    expect(shouldSeedDemoData([], [])).toBe(true);
  });

  it('舊版單長者 seed（無 accountCode）→ true', () => {
    const elders = [elder('seed-elder-01')];
    const users = [user('u1', 'elder', 'seed-elder-01'), user('u2', 'caregiver', 'c1')];
    expect(shouldSeedDemoData(elders, users)).toBe(true);
  });

  it('雲端舊資料（長者存在但 account 冇綁定）→ true', () => {
    const elders = [elder('elder-a'), elder('elder-b')];
    const users = [user('u1', 'elder', 'elder-x')]; // refId 唔對應任何長者
    expect(shouldSeedDemoData(elders, users)).toBe(true);
  });

  it('已有 demo account 綁定 → false', () => {
    const elders = [elder('seed-elder-01')];
    const users = [user('u1', 'elder', 'seed-elder-01', 'demo-001')];
    expect(shouldSeedDemoData(elders, users)).toBe(false);
  });
});

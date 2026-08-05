/**
 * medicationSearch 單測：matchMedications confidence 矩陣。
 *
 * 藥物涉及健康：只有 exact/normalized/prefix 單一或明確領先才 high；
 * contains/fuzzy 一律 low；無結果 none。
 */
import { describe, expect, it } from 'vitest';

import { matchMedications } from '../medicationSearch';
import type { Medication } from '../../types/entities';

let seq = 0;
const med = (name: string, dosage = '1 粒'): Medication => {
  seq += 1;
  return {
    id: `med-${seq}`,
    elderId: 'elder-1',
    name,
    dosage,
    schedule: '每天早上 8 時',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

describe('matchMedications confidence 矩陣', () => {
  it('exact 單一命中 → high', () => {
    const r = matchMedications('降壓藥', [med('降壓藥'), med('維他命C')]);
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].name).toBe('降壓藥');
  });

  it('normalized（大小寫）命中 → high', () => {
    const r = matchMedications('amoxicillin', [med('Amoxicillin'), med('胰島素')]);
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].name).toBe('Amoxicillin');
  });

  it('prefix 命中 → high', () => {
    const r = matchMedications('維他命', [med('維他命C', '1 片'), med('胰島素', '1 支')]);
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].name).toBe('維他命C');
  });

  it('全部命中皆為強 tier（明確領先）→ high', () => {
    const r = matchMedications('維他命', [
      med('維他命C', '1 片'),
      med('維他命B', '1 片'),
    ]);
    expect(r.confidence).toBe('high');
    expect(r.candidates).toHaveLength(2);
  });

  it('僅 contains 命中 → low（須人工確認）', () => {
    const r = matchMedications('他命', [med('維他命C'), med('胰島素', '1 支')]);
    expect(r.confidence).toBe('low');
  });

  it('僅 fuzzy 命中 → low（須人工確認）', () => {
    const r = matchMedications('amoxicilin', [med('Amoxicillin'), med('胰島素', '1 支')]);
    expect(r.confidence).toBe('low');
    expect(r.candidates[0].name).toBe('Amoxicillin');
  });

  it('強弱混雜但強匹配單一（明確領先）→ high', () => {
    const r = matchMedications('降壓', [med('降壓藥'), med('降血壓片', '1 片')]);
    // 「降壓藥」prefix（強、唯一）、「降血壓片」contains（弱）
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].name).toBe('降壓藥');
  });

  it('多個強匹配混雜弱匹配（領先不明確）→ low', () => {
    const r = matchMedications('維他命', [
      med('維他命C', '1 片'),
      med('維他命B', '1 片'),
      med('含維他命糖漿', '1 湯匙'),
    ]);
    // 兩個 prefix + 一個 contains → 領先不明確
    expect(r.confidence).toBe('low');
  });

  it('無任何命中 → none', () => {
    const r = matchMedications('完全無關的嘢', [med('維他命C')]);
    expect(r.confidence).toBe('none');
    expect(r.candidates).toEqual([]);
  });

  it('空白查詢 → none', () => {
    expect(matchMedications('   ', [med('維他命C')])).toEqual({
      candidates: [],
      confidence: 'none',
    });
  });

  it('空藥物列表 → none', () => {
    expect(matchMedications('維他命', [])).toEqual({ candidates: [], confidence: 'none' });
  });

  it('對 dosage 也能命中（exact）', () => {
    const r = matchMedications('30 mg', [med('降壓藥', '30 mg'), med('維他命C', '1 粒')]);
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].name).toBe('降壓藥');
  });

  it('藥名命中優先於劑量命中（同 tier 時 name 排前）', () => {
    // A 的 dosage 與查詢 exact，B 的 name 與查詢 exact → B（name）排前
    const a = med('維他命C', '降壓藥');
    const b = med('降壓藥', '1 粒');
    const r = matchMedications('降壓藥', [a, b]);
    expect(r.confidence).toBe('high');
    expect(r.candidates[0].id).toBe(b.id);
  });

  it('同一藥物 name/dosage 雙命中不重複出現', () => {
    const m = med('維他命C', '維他命C 1 片');
    const r = matchMedications('維他命C', [m]);
    expect(r.candidates).toHaveLength(1);
  });
});

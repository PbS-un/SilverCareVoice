/**
 * doseFormat 單測：formatDose / parseDosage 往返與 seed 格式兼容。
 */
import { describe, expect, it } from 'vitest';

import { DOSE_UNITS, formatDose, parseDosage } from '../doseFormat';

describe('DOSE_UNITS', () => {
  it('包含全部指定單位', () => {
    expect([...DOSE_UNITS]).toEqual([
      '粒', '片', '包', '粉包', '毫克 mg', '克 g', '毫升 ml',
      '茶匙', '湯匙', '滴', '支', '噴', '貼', '其他',
    ]);
  });
});

describe('formatDose', () => {
  it('與 seed 格式兼容：「1 粒」', () => {
    expect(formatDose(1, '粒')).toBe('1 粒');
  });

  it('mg/g/ml 輸出國際簡寫', () => {
    expect(formatDose(30, '毫克 mg')).toBe('30 mg');
    expect(formatDose(5, '克 g')).toBe('5 g');
    expect(formatDose(10, '毫升 ml')).toBe('10 ml');
  });

  it('其餘單位維持「數值 單位」', () => {
    expect(formatDose(2, '片')).toBe('2 片');
    expect(formatDose(1, '茶匙')).toBe('1 茶匙');
    expect(formatDose(0.5, '粒')).toBe('0.5 粒');
  });

  it('「其他」單位使用 customUnit', () => {
    expect(formatDose(4, '其他', '國際單位 IU')).toBe('4 國際單位 IU');
    expect(formatDose(4, '其他')).toBe('4');
  });

  it('無單位時只輸出數值', () => {
    expect(formatDose(3, undefined)).toBe('3');
    expect(formatDose(3, '')).toBe('3');
  });

  it('字串數值可接受', () => {
    expect(formatDose('30', '毫克 mg')).toBe('30 mg');
  });

  it('無效數值回傳空字串', () => {
    expect(formatDose(undefined, '粒')).toBe('');
    expect(formatDose('abc', '粒')).toBe('');
  });
});

describe('parseDosage', () => {
  it('解析「1 粒」（seed 格式）', () => {
    expect(parseDosage('1 粒')).toEqual({ amount: 1, unit: '粒' });
  });

  it('解析「30mg」與「30 mg」（無空白／有空白）', () => {
    expect(parseDosage('30mg')).toEqual({ amount: 30, unit: '毫克 mg' });
    expect(parseDosage('30 mg')).toEqual({ amount: 30, unit: '毫克 mg' });
  });

  it('解析 g / ml 簡寫與中文', () => {
    expect(parseDosage('5g')).toEqual({ amount: 5, unit: '克 g' });
    expect(parseDosage('2 毫升')).toEqual({ amount: 2, unit: '毫升 ml' });
  });

  it('解析「半粒」→ 0.5', () => {
    expect(parseDosage('半粒')).toEqual({ amount: 0.5, unit: '粒' });
  });

  it('純數值（無單位）', () => {
    expect(parseDosage('3')).toEqual({ amount: 3, unit: undefined });
  });

  it('無法辨識單位 → null（UI 顯示原文）', () => {
    expect(parseDosage('每日一次')).toBeNull();
    expect(parseDosage('遵醫囑')).toBeNull();
  });

  it('空字串 → null', () => {
    expect(parseDosage('')).toBeNull();
    expect(parseDosage('   ')).toBeNull();
  });
});

describe('format ↔ parse 往返', () => {
  it.each(['1 粒', '2 片', '30 mg', '5 g', '10 ml', '1 包'])('%s 解析後重組回原文', (text) => {
    const parsed = parseDosage(text);
    expect(parsed).not.toBeNull();
    expect(formatDose(parsed!.amount, parsed!.unit)).toBe(text);
  });
});

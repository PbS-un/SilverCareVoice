/**
 * textMatch 單測：normalizeText 正規化 + rankMatches 五級分級表。
 */
import { describe, expect, it } from 'vitest';

import { normalizeText, rankMatches } from '../textMatch';

describe('normalizeText', () => {
  it('trim + lowercase', () => {
    expect(normalizeText('  Amoxicillin ')).toBe('amoxicillin');
  });

  it('全形轉半形（NFKC）', () => {
    expect(normalizeText('Ａｍｏｘｉｃｉｌｌｉｎ')).toBe('amoxicillin');
    expect(normalizeText('１２３')).toBe('123');
  });

  it('去除所有空白', () => {
    expect(normalizeText('blood pressure')).toBe('bloodpressure');
    expect(normalizeText('維他命 C')).toBe('維他命c');
  });

  it('null/undefined/空字串回傳空字串', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('')).toBe('');
  });
});

describe('rankMatches 分級表', () => {
  const candidates = ['降壓藥', '維他命C', 'Amoxicillin', '血壓計', '胰島素'];
  const rank = (q: string) => rankMatches(q, candidates, (s) => s);
  const tiers = (q: string) => rank(q).map((r) => [r.tier, r.item]);

  it('exact：原始字串完全相同', () => {
    expect(rank('降壓藥')[0]).toMatchObject({ tier: 'exact', item: '降壓藥' });
  });

  it('normalized：大小寫差異', () => {
    expect(rank('amoxicillin')[0]).toMatchObject({ tier: 'normalized', item: 'Amoxicillin' });
  });

  it('normalized：全形／空白差異', () => {
    expect(rank('維他命　c')[0]).toMatchObject({ tier: 'normalized', item: '維他命C' });
  });

  it('prefix：前綴匹配', () => {
    expect(rank('血壓')[0]).toMatchObject({ tier: 'prefix', item: '血壓計' });
  });

  it('contains：包含匹配', () => {
    expect(rank('壓藥')[0]).toMatchObject({ tier: 'contains', item: '降壓藥' });
  });

  it('fuzzy：拼寫近似（Fuse.js）', () => {
    const r = rank('amoxicilin');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ tier: 'fuzzy', item: 'Amoxicillin' });
  });

  it('排序按 tier 優先序（exact > normalized > prefix > contains > fuzzy）', () => {
    const mixed = rankMatches('維他命C', ['XYZ維他命C', '維他命c', '維他命C', '維他'], (s) => s);
    const order = mixed.map((r) => r.tier);
    expect(order[0]).toBe('exact');
    expect(order[1]).toBe('normalized');
    // 其餘依 tier 優先序遞減（prefix/contains/fuzzy 皆可出現）
    const rankOf = { exact: 0, normalized: 1, prefix: 2, contains: 3, fuzzy: 4 } as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(rankOf[order[i]]).toBeGreaterThanOrEqual(rankOf[order[i - 1]]);
    }
  });

  it('中文查詢命中中文候選', () => {
    expect(rank('胰島')[0]).toMatchObject({ tier: 'prefix', item: '胰島素' });
  });

  it('空白查詢回傳空陣列', () => {
    expect(rankMatches('   ', candidates, (s) => s)).toEqual([]);
  });

  it('空候選回傳空陣列', () => {
    expect(rankMatches('降壓藥', [], (s) => s)).toEqual([]);
  });

  it('完全不相關的文字不出現', () => {
    const items = tiers('zzzzzzzzz');
    expect(items.find(([, item]) => item === '胰島素')).toBeUndefined();
  });
});

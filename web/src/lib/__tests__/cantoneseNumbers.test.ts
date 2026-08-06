/**
 * T8.3 粵語數字 normalisation 測試。
 */
import {
  normalizeCantoneseNumbers,
  parseCantoneseNumber,
} from '../cantoneseNumbers';

describe('parseCantoneseNumber', () => {
  it('compact 數字串', () => {
    expect(parseCantoneseNumber('一五八')).toBe(158);
    expect(parseCantoneseNumber('九五')).toBe(95);
    expect(parseCantoneseNumber('七二')).toBe(72);
  });

  it('完整／口語壓縮說法', () => {
    expect(parseCantoneseNumber('一百五十八')).toBe(158);
    expect(parseCantoneseNumber('百五八')).toBe(158);
    expect(parseCantoneseNumber('九十五')).toBe(95);
    expect(parseCantoneseNumber('十五')).toBe(15);
    expect(parseCantoneseNumber('一百零八')).toBe(108);
  });

  it('小數說法', () => {
    expect(parseCantoneseNumber('七點二')).toBe(7.2);
    expect(parseCantoneseNumber('七個二')).toBe(7.2);
    expect(parseCantoneseNumber('六點五')).toBe(6.5);
  });

  it('阿拉伯數字直通', () => {
    expect(parseCantoneseNumber('158')).toBe(158);
    expect(parseCantoneseNumber('7.2')).toBe(7.2);
  });

  it('解析唔到回 undefined', () => {
    expect(parseCantoneseNumber('hello')).toBeUndefined();
    expect(parseCantoneseNumber('')).toBeUndefined();
  });
});

describe('normalizeCantoneseNumbers', () => {
  it('句子內數字轉阿拉伯數字', () => {
    expect(normalizeCantoneseNumbers('我今日血壓一百五十八，九十五')).toBe(
      '我今日血壓158，95',
    );
    expect(normalizeCantoneseNumbers('血糖七點二')).toBe('血糖7.2');
    expect(normalizeCantoneseNumbers('上壓一五八下壓九五')).toBe('上壓158下壓95');
  });

  it('唔會誤傷單字量詞（一粒／兩個）', () => {
    expect(normalizeCantoneseNumbers('我食咗一粒藥')).toBe('我食咗一粒藥');
    expect(normalizeCantoneseNumbers('兩個孫嚟探我')).toBe('兩個孫嚟探我');
  });

  it('空字串原樣回傳', () => {
    expect(normalizeCantoneseNumbers('')).toBe('');
  });
});

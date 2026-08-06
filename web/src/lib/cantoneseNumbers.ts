/**
 * cantoneseNumbers.ts — 澳門／粵語長者常見數字說法 normalisation（T8.3）
 *
 * 例子：
 *   一五八 → 158、一百五十八 → 158、百五八 → 158
 *   九五 → 95、九十五 → 95
 *   七點二 → 7.2、七個二 → 7.2
 *
 * reusable utility：ASR 語音路徑先 normalize 再送入 extraction／AI pipeline。
 */

const DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const DIGIT_RE = /^[零一二兩两三四五六七八九]+$/;

/** 純數字串（一五八 → 158）。 */
function parseDigitString(s: string): number | undefined {
  if (!DIGIT_RE.test(s)) return undefined;
  let out = 0;
  for (const ch of s) {
    const d = DIGIT[ch];
    if (d === undefined) return undefined;
    out = out * 10 + d;
  }
  return out;
}

/** 含「十」的整數（九十五 → 95、十五 → 15）。 */
function parseWithShi(s: string): number | undefined {
  const idx = s.indexOf('十');
  if (idx < 0) return undefined;
  const before = s.slice(0, idx);
  const after = s.slice(idx + 1);
  let tens: number;
  if (!before || before === '一') tens = 10;
  else if (DIGIT[before] !== undefined) tens = DIGIT[before] * 10;
  else return undefined;
  let ones = 0;
  if (after) {
    if (DIGIT[after] === undefined) return undefined;
    ones = DIGIT[after];
  }
  return tens + ones;
}

/** 含「百」的整數（一百五十八 → 158、百五八 → 158、一百零八 → 108）。 */
function parseWithBai(s: string): number | undefined {
  const idx = s.indexOf('百');
  if (idx < 0) return undefined;
  const before = s.slice(0, idx);
  const after = s.slice(idx + 1);
  let hundreds: number;
  if (!before || before === '零') hundreds = 100;
  else if (DIGIT[before] !== undefined) hundreds = DIGIT[before] * 100;
  else return undefined;

  if (!after) return hundreds;

  if (after.includes('十')) {
    const rest = parseWithShi(after);
    return rest === undefined ? undefined : hundreds + rest;
  }
  // 口語壓縮：百五八 = 158（百後兩位直接當十位＋個位）
  if (/^[零一二兩两三四五六七八九]{2}$/.test(after)) {
    return hundreds + DIGIT[after[0]] * 10 + DIGIT[after[1]];
  }
  if (/^[零一二兩两三四五六七八九]$/.test(after)) {
    return hundreds + DIGIT[after] * 10;
  }
  return undefined;
}

/** 解析單一粵語數字字串；解析唔到回 undefined。 */
export function parseCantoneseNumber(raw: string): number | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);

  // 小數：七點二／七個二 → 7.2
  const dec = s.match(/^(.+?)[點点个個](.+)$/);
  if (dec) {
    const int = parseCantoneseInteger(dec[1]);
    if (int === undefined) return undefined;
    const frac = dec[2].split('').map((ch) => DIGIT[ch]);
    if (frac.some((d) => d === undefined)) return undefined;
    const fracVal = frac.reduce((acc, d) => acc * 10 + d, 0);
    return int + fracVal / 10 ** frac.length;
  }

  return parseCantoneseInteger(s);
}

/** 解析粵語整數（不含小數）。 */
export function parseCantoneseInteger(s: string): number | undefined {
  const digits = parseDigitString(s);
  if (digits !== undefined) return digits;
  const withBai = parseWithBai(s);
  if (withBai !== undefined) return withBai;
  return parseWithShi(s);
}

const DEC_RE = /[零一二兩两三四五六七八九]+[點点个個][零一二兩两三四五六七八九]+/g;
const BAI_SHI_RE = /[零一二兩两三四五六七八九]*[十百][零一二兩两三四五六七八九十]*/g;
const COMPACT_RE = /[一二兩两三四五六七八九]{2,}/g;

/** 把文字中嘅粵語數字說法換成阿拉伯數字（用於 ASR transcript 預處理）。 */
export function normalizeCantoneseNumbers(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(DEC_RE, (m) => {
    const n = parseCantoneseNumber(m);
    return n === undefined ? m : String(n);
  });
  out = out.replace(BAI_SHI_RE, (m) => {
    const n = parseCantoneseNumber(m);
    return n === undefined ? m : String(n);
  });
  out = out.replace(COMPACT_RE, (m) => {
    const n = parseCantoneseNumber(m);
    return n === undefined ? m : String(n);
  });
  return out;
}

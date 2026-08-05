/**
 * 劑量格式化／解析（純函數）。
 *
 * 與 seed 既有格式兼容：seed 的 dosage 是「1 粒」，
 * formatDose(1, '粒') 必須輸出「1 粒」。
 * 毫克／克／毫升 單位輸出簡寫：「30 mg」「5 g」「10 ml」。
 */

/** 劑量單位選項（UI 下拉與解析共用；順序即顯示順序）。 */
export const DOSE_UNITS = [
  '粒',
  '片',
  '包',
  '粉包',
  '毫克 mg',
  '克 g',
  '毫升 ml',
  '茶匙',
  '湯匙',
  '滴',
  '支',
  '噴',
  '貼',
  '其他',
] as const;

/** DOSE_UNITS 的 union type。 */
export type DoseUnit = (typeof DOSE_UNITS)[number];

/** 輸出簡寫映射：mg/g/ml 單位以國際簡寫顯示。 */
const UNIT_SHORT: Record<string, string> = {
  '毫克 mg': 'mg',
  '克 g': 'g',
  '毫升 ml': 'ml',
};

/** 解析時接受的單位別名 → DOSE_UNITS 正規值。 */
const UNIT_ALIAS: Record<string, string> = {
  毫克: '毫克 mg',
  mg: '毫克 mg',
  克: '克 g',
  g: '克 g',
  毫升: '毫升 ml',
  ml: '毫升 ml',
};

/**
 * 組裝劑量字串。
 *
 * 規則：
 * - unit 為「其他」時改用 customUnit（customUnit 缺省則只輸出數值）。
 * - 「毫克 mg」「克 g」「毫升 ml」輸出簡寫：「30 mg」「5 g」「10 ml」。
 * - 其餘單位輸出「數值 單位」：「1 粒」（與 seed 格式兼容）。
 * - amount 無法轉為數字（undefined/NaN）時回傳空字串。
 *
 * @param amount     劑量數值（number 或可轉數字之字串）。
 * @param unit       DOSE_UNITS 之一（可缺省）。
 * @param customUnit unit 為「其他」時的自訂單位文字。
 * @returns 如「1 粒」「30 mg」；無有效數值時回傳 ''。
 */
export function formatDose(
  amount: number | string | undefined,
  unit: string | undefined,
  customUnit?: string,
): string {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (amount === undefined || amount === null || amount === '' || Number.isNaN(num)) {
    return '';
  }

  let unitText: string;
  if (unit === '其他') {
    unitText = (customUnit ?? '').trim();
  } else {
    unitText = (unit ?? '').trim();
  }
  unitText = UNIT_SHORT[unitText] ?? unitText;

  const amountText = String(num);
  return unitText ? `${amountText} ${unitText}` : amountText;
}

/** parseDosage 的回傳結構（盡力解析，欄位皆可缺省）。 */
export interface ParsedDosage {
  amount?: number;
  /** 正規化後的單位（DOSE_UNITS 之一）；無法辨識時整個回傳 null。 */
  unit?: string;
}

/**
 * 盡力解析劑量字串為結構化 { amount, unit }。
 *
 * 支援：「1 粒」「30mg」「30 mg」「半粒」「2 毫升」等。
 * 單位須能對應 DOSE_UNITS（含 mg/g/ml 別名），否則視為無法解析。
 *
 * @param dosage 原始劑量字串。
 * @returns 解析結果；解析不到（空字串／單位無法辨識）回傳 null，
 *          讓 UI 直接顯示原文。
 */
export function parseDosage(dosage: string): ParsedDosage | null {
  const s = (dosage ?? '').trim();
  if (!s) return null;

  // 開頭可選數值（含「半」＝0.5），其餘為單位文字
  const m = s.match(/^(?:([0-9]+(?:\.[0-9]+)?|半)\s*)?([\s\S]*)$/);
  if (!m) return null;

  const rawAmount = m[1];
  const rawUnit = (m[2] ?? '').trim();

  let amount: number | undefined;
  if (rawAmount === '半') {
    amount = 0.5;
  } else if (rawAmount) {
    amount = Number(rawAmount);
  }

  let unit: string | undefined;
  if (rawUnit) {
    const normalizedKey = rawUnit.toLowerCase();
    if (UNIT_ALIAS[normalizedKey]) {
      unit = UNIT_ALIAS[normalizedKey];
    } else if ((DOSE_UNITS as readonly string[]).includes(rawUnit)) {
      unit = rawUnit;
    } else if (UNIT_ALIAS[rawUnit]) {
      unit = UNIT_ALIAS[rawUnit];
    } else {
      // 單位無法辨識（如「每日一次」）→ 整體回傳 null，UI 顯示原文
      return null;
    }
  }

  if (amount === undefined && unit === undefined) return null;
  return { amount, unit };
}

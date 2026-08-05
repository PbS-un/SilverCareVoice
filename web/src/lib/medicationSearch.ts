/**
 * 藥物匹配：以用戶輸入（語音／文字）對現有藥物列表做分級檢索。
 *
 * 對 name 與 dosage 同時檢索，藥名（name）優先：
 * 同一藥物若在 name 與 dosage 都命中，取較強 tier，同 tier 時 name 優先。
 *
 * ⚠️ 藥物涉及健康，低置信（low）匹配必須經人工確認 —— UI 在 confidence
 * 為 'low' 時必須明確提示用戶核對，絕不可靜默自動套用。
 */

import type { Medication } from '../types/entities';
import { rankMatches, type MatchTier, type RankedMatch } from './textMatch';

/** 匹配置信度。 */
export type MedicationConfidence = 'high' | 'low' | 'none';

/** matchMedications 回傳結果。 */
export interface MedicationMatchResult {
  /** 依匹配強度排序的藥物候選（可能為空）。 */
  candidates: Medication[];
  /**
   * 置信度：
   * - high：exact/normalized/prefix 命中且單一或明確領先（可放心預填）。
   * - low：僅 contains/fuzzy 命中（必須人工確認）。
   * - none：無任何命中。
   */
  confidence: MedicationConfidence;
}

/** 視為「強匹配」的 tier（可自動預填）。 */
const STRONG_TIERS: MatchTier[] = ['exact', 'normalized', 'prefix'];

/** tier 強度序（越小越強）。 */
const TIER_RANK: Record<MatchTier, number> = {
  exact: 0,
  normalized: 1,
  prefix: 2,
  contains: 3,
  fuzzy: 4,
};

/**
 * 以查詢字串匹配藥物列表。
 *
 * 合併策略：分別對 name 與 dosage 執行 rankMatches，
 * 同一藥物保留最佳 tier（name 命中在同 tier 時優先），最後按 tier 排序。
 *
 * @param query 用戶輸入（語音轉文字或手動輸入）；空白回傳 { candidates: [], confidence: 'none' }。
 * @param meds  既有藥物列表。
 * @returns 候選藥物與置信度。
 */
export function matchMedications(
  query: string,
  meds: Medication[],
): MedicationMatchResult {
  const q = (query ?? '').trim();
  if (!q || meds.length === 0) return { candidates: [], confidence: 'none' };

  const byName = rankMatches(q, meds, (m) => m.name);
  const byDosage = rankMatches(q, meds, (m) => m.dosage);

  // 合併：以藥物 id 去重，保留最佳 tier；同 tier 時 name 命中優先
  const merged = new Map<string, { med: Medication; tier: MatchTier; score: number; viaName: boolean }>();

  const absorb = (r: RankedMatch<Medication>, viaName: boolean): void => {
    const prev = merged.get(r.item.id);
    if (
      !prev ||
      TIER_RANK[r.tier] < TIER_RANK[prev.tier] ||
      (TIER_RANK[r.tier] === TIER_RANK[prev.tier] && viaName && !prev.viaName)
    ) {
      merged.set(r.item.id, { med: r.item, tier: r.tier, score: r.score, viaName });
    }
  };

  for (const r of byName) absorb(r, true);
  for (const r of byDosage) absorb(r, false);

  const ranked = [...merged.values()].sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      (a.viaName === b.viaName ? a.score - b.score : a.viaName ? -1 : 1),
  );

  if (ranked.length === 0) return { candidates: [], confidence: 'none' };

  const strong = ranked.filter((r) => STRONG_TIERS.includes(r.tier));
  const topTier = ranked[0].tier;
  const topTierCount = ranked.filter((r) => r.tier === topTier).length;
  // confidence 規則：
  // - 無強匹配（僅 contains/fuzzy）→ low（藥物涉及健康，必須人工確認）
  // - 強匹配單一命中、全部命中皆為強匹配（明確領先），
  //   或最佳 tier 唯一（強弱混雜但領先明確）→ high
  // - 最佳 tier 多於一項（領先不明確）→ low
  const confidence: MedicationConfidence =
    strong.length > 0 &&
    (strong.length === 1 || strong.length === ranked.length || topTierCount === 1)
      ? 'high'
      : 'low';

  return { candidates: ranked.map((r) => r.med), confidence };
}

/**
 * SilverCare Voice — 澳門長者知識庫（T9）
 *
 * 三大 category：
 *   - policy  ：特區政府長者政策與津貼（≥10 條）
 *   - health  ：長者日常健康與自我管理（≥10 條）
 *   - service ：社區醫療與支援服務資源（≥8 條）
 *
 * 內容以公開常識性描述撰寫，凡涉及金額／收費一律不寫死數字，
 * 以「以官方最新公佈為準」表述。ID 固定前綴 'kb-*'，方便斷言與幂等導入。
 *
 * 導入方式：由 core/kb/search.ts 的 ensureKnowledgeLoaded() 在
 * IndexedDB knowledgeDocuments 表為空時 bulkPut 寫入（冪等）。
 */

import type { KnowledgeDocument } from '../types/entities';

/** 知識庫條目：KnowledgeDocument + 選填電話欄位。 */
export interface KnowledgeBaseEntry extends KnowledgeDocument {
  phone?: string;
}

export type KnowledgeCategory = 'policy' | 'health' | 'service';

const SOURCE_GOV = '整理自澳門特區政府公開資訊（Demo 資料，以官方最新公佈為準）';
const SOURCE_HEALTH = '整理自澳門衛生局公開健康資訊（Demo 資料，以官方最新公佈為準）';

/** 固定 ISO 時間（2026-07-15 00:00 UTC）。 */
function ts(day: number): string {
  return `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;
}

function entry(
  id: string,
  category: KnowledgeCategory,
  title: string,
  summary: string,
  opts: {
    source?: string;
    day?: number;
    eligibility?: string;
    location?: string;
    phone?: string;
  } = {},
): KnowledgeBaseEntry {
  const t = ts(opts.day ?? 15);
  return {
    id,
    category,
    title,
    summary,
    eligibility: opts.eligibility,
    location: opts.location,
    phone: opts.phone,
    source: opts.source ?? SOURCE_GOV,
    createdAt: t,
    updatedAt: t,
  };
}

/* ──────────────── policy（11 條） ──────────────── */

const POLICY: KnowledgeBaseEntry[] = [
  entry('kb-policy-01', 'policy', '敬老金（社會保障基金）', 
    '社會保障基金每年向合資格的澳門長者發放敬老金，係俗稱嘅老人津貼、長者津貼，表達對長者嘅敬老心意。合資格長者會收到領取通知，金額以官方最新公佈為準。',
    { day: 2, eligibility: '年滿 65 歲、持有澳門居民身份證嘅長者' }),
  entry('kb-policy-02', 'policy', '養老金（社會保障制度）',
    '社會保障制度嘅養老金係每月發放嘅長者生活保障，幫助退休長者應付基本生活開支。申請要符合供款同居住條件，金額以官方最新公佈為準。',
    { day: 2, eligibility: '年滿 65 歲並符合供款條件嘅澳門居民' }),
  entry('kb-policy-03', 'policy', '殘疾津貼',
    '經評定為殘疾嘅人士，包括長者，可以申請社會保障制度嘅殘疾津貼，補助日常照顧同生活需要。須經指定評定程序，金額以官方最新公佈為準。',
    { day: 3, eligibility: '經殘疾評定委員會評定為殘疾嘅澳門居民' }),
  entry('kb-policy-04', 'policy', '醫療券計劃',
    '政府每年向澳門永久性居民發放醫療券，可以用嚟抵扣私營醫療機構嘅診金同部分醫療費用，方便長者睇私家醫生。面額同使用規則以官方最新公佈為準。',
    { day: 3, eligibility: '澳門永久性居民（長者同樣合資格）' }),
  entry('kb-policy-05', 'policy', '長者巴士車資優惠與乘車碼',
    '年滿 65 歲嘅長者搭公共巴士有車資優惠，申請個人乘車碼（巴士二維碼）後掃碼上車就會自動享優惠，係長者常用嘅交通優惠。詳情以官方最新公佈為準。',
    { day: 4, eligibility: '年滿 65 歲嘅澳門居民', location: '全澳公共巴士' }),
  entry('kb-policy-06', 'policy', '社會房屋與經濟房屋長者安排',
    '長者住戶可以按規定申請社會房屋或經濟房屋，社屋對長者申請有優先處理同特別安排，獨居長者都可按條件獲配合適單位。申請詳情以房屋局最新公佈為準。',
    { day: 4, eligibility: '符合入息同資產限制嘅長者住戶' }),
  entry('kb-policy-07', 'policy', '平安鐘（個人緊急呼援服務）',
    '平安鐘服務適合獨居長者、雙老長者或需要照顧嘅長者。一按緊急呼援掣就會接通 24 小時支援中心，提供召援同轉介協助，令長者喺屋企都安心。可向社會工作局或服務機構申請。',
    { day: 5, eligibility: '獨居、雙老或有照顧需要嘅長者' }),
  entry('kb-policy-08', 'policy', '家居照顧服務',
    '家居照顧服務會安排照顧員上門，協助自理有困難嘅長者處理個人護理、陪同覆診同簡單家務，讓長者可以留喺熟悉嘅社區生活。可向社工局或社區服務單位查詢申請。',
    { day: 5, eligibility: '自理能力有困難、需要家居支援嘅長者' }),
  entry('kb-policy-09', 'policy', '長者公寓',
    '政府興建長者公寓，為能夠自理嘅長者提供有無障礙設計同支援服務嘅租住單位，幫助長者喺社區獨立生活。申請資格同收費以官方最新公佈為準。',
    { day: 6, eligibility: '年滿 65 歲、能夠自理嘅長者', location: '澳門' }),
  entry('kb-policy-10', 'policy', '獨居長者支援服務',
    '社區中心同社會服務機構會為獨居長者提供定期探訪、電話問安同送飯轉介等支援。獨居長者或家人可以向所屬區嘅社區中心登記，建立社區照顧網絡。',
    { day: 6, eligibility: '獨居長者' }),
  entry('kb-policy-11', 'policy', '長者卡與公共優惠',
    '年滿 65 歲嘅長者可以申請長者卡，憑卡享用多項公共設施優惠同折扣，例如體育場館、公園設施等。出街記得帶長者卡同身份證，優惠詳情以官方最新公佈為準。',
    { day: 7, eligibility: '年滿 65 歲嘅澳門居民' }),
];

/* ──────────────── health（11 條） ──────────────── */

const HEALTH: KnowledgeBaseEntry[] = [
  entry('kb-health-01', 'health', '高血壓日常護理',
    '有高血壓嘅長者要每日按時食藥，定時量血壓同做記錄。飲食要少鹽少油，瞓得夠、心情放鬆。如果血壓明顯比平日高，或者伴隨頭暈、頭痛，要盡快聯絡家人或睇醫生。',
    { source: SOURCE_HEALTH, day: 8 }),
  entry('kb-health-02', 'health', '量血壓正確方法',
    '量血壓之前坐低休息五分鐘，唔好飲濃茶咖啡。手臂放喺同心臟同一水平，量嘅時候唔好郁、唔好講嘢。建議每日早晚固定時間量，並將結果寫低，覆診時帶俾醫生睇。',
    { source: SOURCE_HEALTH, day: 8 }),
  entry('kb-health-03', 'health', '糖尿病飲食要點',
    '糖尿病患者要定時定量食飯，少食甜食同含糖飲品，多食蔬菜同五穀。按時量血糖並記錄，方便醫生調校藥物。如果出現心悒、冷汗、頭暈等低血糖徵狀，要即刻食少少甜食並求助。',
    { source: SOURCE_HEALTH, day: 9 }),
  entry('kb-health-04', 'health', '按時食藥嘅重要性',
    '長期病藥物要按時食先至有效，千祈唔好自己停藥或者加減份量。可以用藥盒同提醒幫手，避免漏食藥。如果漏咗食藥或者食藥後覺得唔舒服，要問醫生或藥劑師，唔好自己補食雙倍。',
    { source: SOURCE_HEALTH, day: 9 }),
  entry('kb-health-05', 'health', '頭暈常見原因與應對',
    '頭暈可能因為血壓波動、血糖過低、瞓得唔夠，或者起身太急。覺得頭暈要即刻坐低或者瞓低休息，費事跌倒。如果頭暈反覆出現，或者伴隨心悒、講嘢唔清楚、一邊身無力，要盡快睇醫生。',
    { source: SOURCE_HEALTH, day: 10 }),
  entry('kb-health-06', 'health', '頭痛幾時要睇醫生',
    '輕微頭痛多數同瞓得唔夠、緊張有關，休息下、飲杯水先。如果頭痛突然加劇、伴隨嘔吐、視力模糊、手腳無力，或者撞親頭之後先頭痛，就要即刻求助或者去急診。',
    { source: SOURCE_HEALTH, day: 10 }),
  entry('kb-health-07', 'health', '長者運動建議',
    '長者每日做約 30 分鐘適量運動，例如行路、太極、保健操，對血壓同血糖都有幫助。揀光線充足、地面唔濕滑嘅地方，著合適嘅鞋。運動途中覺得唔舒服就要即刻停低休息。',
    { source: SOURCE_HEALTH, day: 11 }),
  entry('kb-health-08', 'health', '防跌倒貼士',
    '起身行路要慢，企穩先行；沖涼房裝扶手、用防滑墊，屋企通道唔好擺雜物，燈光要夠。有需要的話用行山杖或助行器，唔好夾硬。跌倒係長者最常見嘅意外，預防最重要。',
    { source: SOURCE_HEALTH, day: 11 }),
  entry('kb-health-09', 'health', '睡眠建議',
    '保持生活規律，下晝之後盡量唔好飲濃茶咖啡，日間適量活動有助晚黑瞓得好。如果長期失眠或者成晚要起身小便、影響精神，可以同醫生傾下，搵下原因。',
    { source: SOURCE_HEALTH, day: 12 }),
  entry('kb-health-10', 'health', '覆診前準備',
    '覆診之前執定覆診卡、身份證同埋食緊嘅藥物清單，有咩新症狀或者想問醫生嘅問題可以寫低。預早少少出門，早少少到医院或者衛生中心。如果覆診唔到，要提早聯絡改期。',
    { source: SOURCE_HEALTH, day: 12 }),
  entry('kb-health-11', 'health', '緊急情況徵兆',
    '如果出現胸口痛、透唔到氣、突然一邊身無力、講嘢唔清楚、暈倒或者大量出血，要即刻打 999 或者叫人幫手叫救護車。獨居長者可以將電話同緊急聯絡電話擺喺當眼就手嘅位置。',
    { source: SOURCE_HEALTH, day: 13 }),
];

/* ──────────────── service（9 條） ──────────────── */

const SERVICE: KnowledgeBaseEntry[] = [
  entry('kb-service-01', 'service', '仁伯爵綜合醫院（山頂醫院）',
    '仁伯爵綜合醫院係澳門主要公立醫院，急診 24 小時服務，長者可以經轉介到專科門診覆診。身體唔舒服又唔肯定去邊，可以先問家庭醫生或者衛生中心。',
    { day: 14, location: '澳門若憲馬路', phone: '28313731' }),
  entry('kb-service-02', 'service', '鏡湖醫院',
    '鏡湖醫院係澳門半島嘅非牟利醫院，設有 24 小時急診同門診服務，住澳門半島嘅長者都可以選擇去嗰度睇病。',
    { day: 14, location: '澳門連勝街', phone: '28371333' }),
  entry('kb-service-03', 'service', '科大醫院',
    '科大醫院位於氹仔，提供門診、專科同急診服務，住氹仔、路環嘅長者可以預約覆診。查詢電話以醫院官方公佈為準。',
    { day: 15, location: '氹仔偉龍馬路澳門科技大學' }),
  entry('kb-service-04', 'service', '各區衛生中心（黑沙環／筷子基／氹仔等）',
    '衛生局喺黑沙環、筷子基、氹仔等各區都設有衛生中心，提供基層醫療服務、慢性病（血壓、血糖）跟進同保健。長者可以喺就近嘅衛生中心登記接受基層醫療照顧，想量血壓都可以去。',
    { day: 15, location: '全澳各區（黑沙環、筷子基、氹仔等）' }),
  entry('kb-service-05', 'service', '緊急求助電話（999／112／消防）',
    '遇到緊急情況可以打 999 或者 112 求助，需要救護車同救援可以打消防局緊急電話 28572222。長者可以將呢啲緊急電話寫低貼喺電話旁邊，有需要即刻打。',
    { day: 16, location: '全澳', phone: '999 / 112 / 28572222' }),
  entry('kb-service-06', 'service', '社會工作局長者服務',
    '社會工作局（社工局）統籌長者服務，包括長者中心、家居照顧、長者公寓等。長者可家人可以向社工局或者區內社區中心查詢有咩服務同點樣申請。',
    { day: 16, location: '澳門' }),
  entry('kb-service-07', 'service', '平安鐘申請渠道',
    '想申請平安鐘個人緊急呼援服務，可以透過社工局或合作服務機構登記，職員會安排安裝同埋教識點樣用。適合獨居長者、雙老家庭或者有需要照顧嘅長者。',
    { day: 17, location: '澳門' }),
  entry('kb-service-08', 'service', '免費量血壓與健康諮詢',
    '衛生中心同部分社區中心提供量血壓同健康諮詢服務，長者可以定期去量血壓、問下护士慢性病護理要注意咩，及早留意自己嘅健康狀況。',
    { day: 17, location: '各衛生中心及社區中心' }),
  entry('kb-service-09', 'service', '社區中心與街坊互助服務',
    '各區社區中心為長者提供活動、送飯轉介、街坊探訪等服務。長者想認識朋友、參加活動或者需要日常生活支援，可以聯絡所在區嘅社區中心或街坊會查詢。',
    { day: 18, location: '全澳各區' }),
];

/** 完整知識庫（31 條：policy 11、health 11、service 9）。 */
export const KNOWLEDGE_BASE: KnowledgeBaseEntry[] = [...POLICY, ...HEALTH, ...SERVICE];

/** 依 category 取條目（供測試／匯出用）。 */
export function knowledgeByCategory(category: KnowledgeCategory): KnowledgeBaseEntry[] {
  return KNOWLEDGE_BASE.filter((d) => d.category === category);
}

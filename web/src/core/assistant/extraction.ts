/**
 * 結構化資料抽取（純函數，無外部依賴）。
 * 用正則 + 詞典做可泛化嘅抽取，支援粵語／口語／書面語多種寫法。
 */

export interface BloodPressureReading {
  systolic: number
  diastolic: number
}

/** 覆診／預約抽取結果（全部可選） */
export interface AppointmentInfo {
  /** ISO date（YYYY-MM-DD），由相對日期詞解析 */
  date?: string
  /** 具體時間（HH:MM）或時段詞（朝早／晏晝／傍晚／夜晚／睡前） */
  time?: string
  location?: string
  department?: string
  doctor?: string
}

export interface ExtractionResult {
  bloodPressure?: BloodPressureReading
  bloodGlucose?: number
  heartRate?: number
  weight?: number
  symptoms: string[]
  medicationName?: string
  medicationStatus?: 'taken' | 'missed' | 'late'
  /** 劑量數值（例：0.5、1、5） */
  medicationDoseAmount?: number | string
  /** 劑量單位（例：粒、毫克、毫升） */
  medicationDoseUnit?: string
  /** 覆診／預約資訊（有講到覆診先會有） */
  appointment?: AppointmentInfo
  /** 聯絡家人線索（搵阿仔／通知監護人／打電話俾…） */
  contactCue?: boolean
  /** 日期／時間詞解析出嘅範圍提示（例：今日、琴日、最近） */
  timeHints: string[]
}

/* ---------------------------------- 生命體徵 ---------------------------------- */

/** 合理範圍：收縮壓 60–260、舒張壓 30–160 */
const SYSTOLIC_RANGE: readonly [number, number] = [60, 260]
const DIASTOLIC_RANGE: readonly [number, number] = [30, 160]

function withinRange(value: number, [min, max]: readonly [number, number]): boolean {
  return value >= min && value <= max
}

function normalizePair(first: number, second: number): BloodPressureReading | undefined {
  let systolic = first
  let diastolic = second
  // 講反咗（舒張高過收縮）就自動調返
  if (systolic < diastolic) {
    ;[systolic, diastolic] = [diastolic, systolic]
  }
  if (!withinRange(systolic, SYSTOLIC_RANGE) || !withinRange(diastolic, DIASTOLIC_RANGE)) {
    return undefined
  }
  return { systolic, diastolic }
}

/**
 * 抽取血壓。支援：
 * 「血壓155/92」「血壓係155上92落」「啱啱量到155 92」「高壓155低壓92」
 * 「上壓155下壓92」「收縮壓155舒張壓92」
 */
export function extractBloodPressure(text: string): BloodPressureReading | undefined {
  if (!text) return undefined

  // 1) 關鍵詞 + 一對數字（分隔號：/ 上 頓號 逗號 空格 至 到 -）
  const labelled = /(?:血壓|血圧|bp)\D{0,6}?(\d{2,3})\s*[/上、，,\s~至到－-]\s*(\d{2,3})/i.exec(text)
  if (labelled) {
    const pair = normalizePair(Number(labelled[1]), Number(labelled[2]))
    if (pair) return pair
  }

  // 2) 高壓／低壓寫法
  const highLow = /高[壓壓]\s*[:：]?\s*(\d{2,3})\D{0,6}?低[壓壓]\s*[:：]?\s*(\d{2,3})/.exec(text)
  if (highLow) {
    const pair = normalizePair(Number(highLow[1]), Number(highLow[2]))
    if (pair) return pair
  }

  // 2b) 上壓／下壓寫法（成對出現）
  const upDown = /上[壓壓]\s*[:：]?\s*(\d{2,3})\D{0,6}?下[壓壓]\s*[:：]?\s*(\d{2,3})/.exec(text)
  if (upDown) {
    const pair = normalizePair(Number(upDown[1]), Number(upDown[2]))
    if (pair) return pair
  }

  // 3) 收縮壓／舒張壓寫法（兩個標籤獨立出現）
  const systolicMatch = /收縮[壓壓]?\s*[:：]?\s*(\d{2,3})/.exec(text)
  const diastolicMatch = /舒張[壓壓]?\s*[:：]?\s*(\d{2,3})/.exec(text)
  if (systolicMatch && diastolicMatch) {
    const pair = normalizePair(Number(systolicMatch[1]), Number(diastolicMatch[1]))
    if (pair) return pair
  }

  // 3b) 上壓／下壓標籤獨立出現（例：「上壓 138，下壓 85」）
  const upLabel = /上[壓壓]\s*[:：]?\s*(\d{2,3})/.exec(text)
  const downLabel = /下[壓壓]\s*[:：]?\s*(\d{2,3})/.exec(text)
  if (upLabel && downLabel) {
    const pair = normalizePair(Number(upLabel[1]), Number(downLabel[1]))
    if (pair) return pair
  }

  // 4) 量度語境 + 一對數字：「啱啱量到155 92」
  const measured = /(?:量到|度到|量咗|量左|度咗|度左|測到|测到)\s*(\d{2,3})\s*[/、，,\s]\s*(\d{2,3})/.exec(text)
  if (measured) {
    const pair = normalizePair(Number(measured[1]), Number(measured[2]))
    if (pair) return pair
  }

  return undefined
}

/** 抽取血糖（mmol/L），合理範圍 1–40 */
export function extractBloodGlucose(text: string): number | undefined {
  if (!text) return undefined
  const match = /(?:血糖|尿糖|糖化)\D{0,6}?(\d{1,2}(?:\.\d+)?)/.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  if (value >= 1 && value <= 40) return value
  return undefined
}

/** 抽取心率（每分鐘下數），合理範圍 30–220。
 * 關鍵字與數字之間禁止出現其他 vital 關鍵詞（血壓／血糖／體重），
 * 避免「心跳快，血壓155/90」把血壓數字抽成心率。 */
export function extractHeartRate(text: string): number | undefined {
  if (!text) return undefined
  const match = /(?:心跳|心率|脈搏|脉搏)(?:(?!血壓|血圧|血糖|體重|体重)\D){0,6}?(\d{2,3})/.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  if (value >= 30 && value <= 220) return value
  return undefined
}

/** 抽取體重（公斤），支援「磅／lb」自動換算，合理範圍 20–300kg */
export function extractWeight(text: string): number | undefined {
  if (!text) return undefined

  const pounds = /(\d{2,3}(?:\.\d+)?)\s*(?:磅|lb)/i.exec(text)
  if (pounds) {
    const kg = Math.round((Number(pounds[1]) / 2.2046) * 10) / 10
    if (kg >= 20 && kg <= 300) return kg
  }

  const match = /(?:體重|体重)\D{0,6}?(\d{2,3}(?:\.\d+)?)/.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  if (value >= 20 && value <= 300) return value
  return undefined
}

/* ---------------------------------- 症狀詞典 ---------------------------------- */

interface SymptomEntry {
  canonical: string
  variants: string[]
}

/** 粵語／書面語症狀變體 → 規範名 */
export const SYMPTOM_DICTIONARY: readonly SymptomEntry[] = [
  { canonical: '頭暈', variants: ['頭暈', '头晕', '暈陀陀', '頭好暈', '暈'] },
  { canonical: '頭痛', variants: ['頭痛', '头疼', '頭好痛'] },
  { canonical: '胸痛', variants: ['胸口痛', '心口痛', '心口翳', '胸痛'] },
  { canonical: '發燒', variants: ['發燒', '发烧', '身熱', '发热'] },
  { canonical: '嘔吐', variants: ['嘔吐', '作嘔', '想嘔', '呕吐', '嘔'] },
  { canonical: '肚瀉', variants: ['肚瀉', '腹瀉', '拉肚子', '屙嘢'] },
  { canonical: '肚痛', variants: ['肚痛', '腹痛', '個肚痛', '肚疼'] },
  { canonical: '胃痛', variants: ['胃痛', '胃脹', '胃好痛'] },
  { canonical: '口渴', variants: ['口渴', '口好乾', '好渴'] },
  { canonical: '眼矇', variants: ['眼矇', '眼訓', '視力模糊', '眼睛模糊', '睇嘢模糊'] },
  { canonical: '腳腫', variants: ['腳眼腫', '腳腫', '脚肿', '腳仔腫'] },
  { canonical: '疲勞', variants: ['冇精神', '疲勞', '好攰', '攰'] },
  { canonical: '失眠', variants: ['瞓唔著', '訓唔著', '睡不著', '睡不着', '失眠', '瞓唔好'] },
  { canonical: '心悸', variants: ['心悒', '心悸', '心跳亂', '心口跳'] },
  { canonical: '咳嗽', variants: ['咳嗽', '久咳', '咳'] },
  { canonical: '麻痺', variants: ['手麻', '腳麻', '麻痺', '麻痹', '發麻'] },
  { canonical: '氣促', variants: ['透唔到氣', '氣促', '氣喘'] },
]

/** 抽取症狀（回傳規範症狀名，去重） */
export function extractSymptoms(text: string): string[] {
  if (!text) return []
  const found = new Set<string>()
  // 長變體優先，避免短詞搶先（例：「眼矇」vs「眼」）
  const entries = SYMPTOM_DICTIONARY.flatMap((entry) =>
    [...entry.variants]
      .sort((a, b) => b.length - a.length)
      .map((variant) => ({ canonical: entry.canonical, variant })),
  ).sort((a, b) => b.variant.length - a.variant.length)

  for (const { canonical, variant } of entries) {
    if (text.includes(variant)) {
      found.add(canonical)
    }
  }
  return [...found]
}

/* ---------------------------------- 藥物 ---------------------------------- */

interface MedicationEntry {
  name: string
  terms: string[]
}

/** 常見藥物類別詞典（模糊匹配） */
export const MEDICATION_DICTIONARY: readonly MedicationEntry[] = [
  { name: '降壓藥', terms: ['降壓藥', '血壓藥', '降压药', '血压药'] },
  { name: '降糖藥', terms: ['降糖藥', '糖尿藥', '糖尿病藥', '降糖药', '胰岛素', '胰島素'] },
  { name: '薄血藥', terms: ['薄血藥', '抗凝血藥', '薄血'] },
  { name: '膽固醇藥', terms: ['膽固醇藥', '降膽固醇藥', '他汀'] },
  { name: '心臟藥', terms: ['心臟藥', '心脏药'] },
  { name: '安眠藥', terms: ['安眠藥', '安眠药', '瞓覺藥'] },
  { name: '止痛藥', terms: ['止痛藥', '止痛药'] },
  { name: '感冒藥', terms: ['感冒藥', '感冒药'] },
]

// 書面語變體統一用 unicode escape，避免檔案編碼差異影響匹配
// 唔記得食｜漏[咗左]食｜冇食｜未食｜忘[了記记][食吃服]｜忘吃｜没吃｜沒吃｜漏服｜忘记
const MISSED_PATTERN =
  /唔記得[食服]|漏[咗左]?[食吃服]|冇食|未食|忘[了記\u8bb0][食吃服]|忘吃|忘记|没吃|沒吃|漏服/
const LATE_PATTERN = /遲[咗左]?[食服]|晚[咗左]?食|迟[了]?[吃服]/
const TAKEN_PATTERN =
  /食[咗左晒]|食完|食過|服[咗左過]|吃[了過完]|吃药|吃過|已[經]?[食服吃]|有食|有服|吃了|服了/

export interface MedicationInfo {
  /** 有冇講到藥物 */
  mentioned: boolean
  name?: string
  status?: 'taken' | 'missed' | 'late'
}

/** 抽取藥物名（模糊匹配）同服用狀態 */
export function extractMedication(text: string): MedicationInfo {
  if (!text) return { mentioned: false }

  let name: string | undefined
  for (const entry of MEDICATION_DICTIONARY) {
    if (entry.terms.some((term) => text.includes(term))) {
      name = entry.name
      break
    }
  }

  let status: MedicationInfo['status']
  if (MISSED_PATTERN.test(text)) {
    status = 'missed'
  } else if (LATE_PATTERN.test(text)) {
    status = 'late'
  } else if (TAKEN_PATTERN.test(text)) {
    status = 'taken'
  }

  const mentioned = name !== undefined || (/藥|药/.test(text) && status !== undefined)
  return { mentioned, name, status }
}

/* ---------------------------------- 劑量 ---------------------------------- */

export interface MedicationDose {
  /** 劑量數值（例：0.5、1、5；中文數字已轉阿拉伯數字） */
  amount: number | string
  /** 劑量單位（例：粒、毫克、毫升） */
  unit: string
}

/** 中文數字 → 阿拉伯數字（一～十九，支援 十／十X／X十 常用範圍） */
const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

function cnNumberToInt(s: string): number | undefined {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const teens = /^十([一二三四五六七八九])$/.exec(s)
  if (teens) return 10 + (CN_DIGIT[teens[1]] ?? Number.NaN)
  const tens = /^([一二三四五六七八九])十([一二三四五六七八九]?)$/.exec(s)
  if (tens) return (CN_DIGIT[tens[1]] ?? Number.NaN) * 10 + (tens[2] ? (CN_DIGIT[tens[2]] ?? Number.NaN) : 0)
  return CN_DIGIT[s]
}

/**
 * 抽取劑量。支援：
 * 「半粒」「一粒」「兩粒」「一粒半」「5毫克」「30mg」「10毫升」
 */
export function extractMedicationDose(text: string): MedicationDose | undefined {
  if (!text) return undefined

  // 1) 阿拉伯數字 + 單位：5毫克／30mg／10毫升／2粒
  const numeric = /(\d{1,3}(?:\.\d+)?)\s*(毫克|毫升|mg|ML|ml|cc|粒|顆|片)/i.exec(text)
  if (numeric) {
    return { amount: Number(numeric[1]), unit: numeric[2] }
  }

  // 2) 「X粒半」／「半粒」
  const cnHalfAfter = /([一二兩两三四五六七八九十]{1,3})\s*(粒|顆|片)\s*半/.exec(text)
  if (cnHalfAfter) {
    const n = cnNumberToInt(cnHalfAfter[1])
    if (n !== undefined) return { amount: n + 0.5, unit: cnHalfAfter[2] }
  }
  const half = /半\s*(粒|顆|片|毫升|毫克)/.exec(text)
  if (half) {
    return { amount: 0.5, unit: half[1] }
  }

  // 3) 中文數字 + 單位：一粒／兩粒／三毫升
  const cn = /([一二兩两三四五六七八九十]{1,3})\s*(粒|顆|片|毫升|毫克)/.exec(text)
  if (cn) {
    const n = cnNumberToInt(cn[1])
    if (n !== undefined) return { amount: n, unit: cn[2] }
  }

  return undefined
}

/* ---------------------------------- 覆診／預約 ---------------------------------- */

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const WEEKDAY_CN: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
}

/**
 * 將相對日期詞解析成 ISO date（YYYY-MM-DD）。
 * 支援：今日／聽日（明天）／後日／下星期一~日／（今個）星期X／下個月／X月X日／D/M。
 * 純函數：今日基準可由參數傳入（測試用），預設 new Date()。
 */
export function resolveRelativeDate(text: string, today: Date = new Date()): string | undefined {
  if (!text) return undefined
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const addDays = (n: number): string => {
    const d = new Date(base)
    d.setDate(d.getDate() + n)
    return isoDate(d)
  }

  // 0) 明確日期優先：「8月6日」「6/8」（港澳習慣：日／月）
  // 跨年回滾：解析結果早於今日（例：12月講「2月1日」）→ 視為明年
  const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]?/.exec(text)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(base.getFullYear(), month - 1, day)
      if (d.getTime() < base.getTime()) d = new Date(base.getFullYear() + 1, month - 1, day)
      return isoDate(d)
    }
  }
  const slash = /(?<!\d)(\d{1,2})\s*[/／]\s*(\d{1,2})(?!\d)/.exec(text)
  if (slash) {
    const day = Number(slash[1])
    const month = Number(slash[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(base.getFullYear(), month - 1, day)
      if (d.getTime() < base.getTime()) d = new Date(base.getFullYear() + 1, month - 1, day)
      return isoDate(d)
    }
  }

  // 1) 今日／聽日／後日（兼容 噚日／琴日 等過去詞——覆診場景較少，仍支援）
  if (/聽日|聽朝|聽晚|明天|明日/.test(text)) return addDays(1)
  if (/後日|後天|后天/.test(text)) return addDays(2)
  if (/今日|今天/.test(text)) return isoDate(base)

  // 2) 下星期X／下個禮拜X —— 下一個曆法週（星期一起計）嘅該星期幾
  const nextWeek = /下(?:個)?(?:星期|禮拜|礼拜|個星期)([一二三四五六日天])/.exec(text)
  if (nextWeek) {
    const target = WEEKDAY_CN[nextWeek[1]]
    if (target !== undefined) {
      const daysToNextMonday = ((8 - base.getDay()) % 7) || 7
      const offsetFromMonday = (target + 6) % 7
      return addDays(daysToNextMonday + offsetFromMonday)
    }
  }

  // 3) 星期X／今個禮拜X —— 最近嘅該星期幾（負向回顧排除「下星期」）
  const thisWeek = /(?<!下)(?:今(?:個)?)?(?:星期|禮拜|礼拜)([一二三四五六日天])/.exec(text)
  if (thisWeek) {
    const target = WEEKDAY_CN[thisWeek[1]]
    if (target !== undefined) {
      const diff = (((target - base.getDay()) % 7) + 7) % 7 || 7
      return addDays(diff)
    }
  }

  // 4a) 下個月X號／下月X日 —— 下月該日（要先於「下個月」近似錨點規則）
  const nextMonthDay = /下(?:個)?月\s*(\d{1,2})\s*[日號号]?/.exec(text)
  if (nextMonthDay) {
    const day = Number(nextMonthDay[1])
    if (day >= 1 && day <= 31) {
      return isoDate(new Date(base.getFullYear(), base.getMonth() + 1, day))
    }
  }

  // 4b) 下個月 —— 下月 1 號（日子未知時嘅近似錨點）
  if (/下(?:個)?月/.test(text)) {
    return isoDate(new Date(base.getFullYear(), base.getMonth() + 1, 1))
  }

  return undefined
}

/** 時段詞 → 近似時間；具體時間（下午三點／15:00）→ HH:MM */
export function extractAppointmentTime(text: string): string | undefined {
  if (!text) return undefined

  const adjustByPeriod = (period: string | undefined, h: number): number => {
    if (h < 0 || h > 23) return h
    if ((period === '下午' || period === '晏晝' || period === '傍晚') && h < 12) return h + 12
    if ((period === '夜晚' || period === '睡前' || period === '臨瞓') && h <= 11) return h + 12
    return h
  }
  const pad = (n: number) => String(n).padStart(2, '0')

  // 1) 數字鐘點：15:00／3：30
  const clock = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(text)
  if (clock) {
    const h = Number(clock[1])
    const m = Number(clock[2])
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${pad(h)}:${pad(m)}`
    }
  }

  // 2) 中文鐘點：下午三點／三點半／十一點鐘
  const PERIOD = '(?:凌晨|朝早|上午|中午|晏晝|下午|傍晚|夜晚|睡前|臨瞓)'
  const halfHour = new RegExp(`(${PERIOD})?\\s*(\\d{1,2}|[一二三四五六七八九十]{1,3})\\s*[點点]\\s*半`).exec(text)
  if (halfHour) {
    const n = cnNumberToInt(halfHour[2])
    if (n !== undefined && n >= 1 && n <= 12) {
      return `${pad(adjustByPeriod(halfHour[1], n))}:30`
    }
  }
  const oClock = new RegExp(`(${PERIOD})?\\s*(\\d{1,2}|[一二三四五六七八九十]{1,3})\\s*[點点](?:[鐘钟])?`).exec(text)
  if (oClock) {
    const n = cnNumberToInt(oClock[2])
    if (n !== undefined && n >= 1 && n <= 12) {
      return `${pad(adjustByPeriod(oClock[1], n))}:00`
    }
  }

  // 3) 時段詞 → 近似時間
  if (/朝早|清晨|朝頭早/.test(text)) return '朝早'
  if (/晏晝/.test(text)) return '晏晝'
  if (/傍晚/.test(text)) return '傍晚'
  if (/睡前|臨瞓/.test(text)) return '睡前'
  if (/夜晚|晚上/.test(text)) return '夜晚'

  return undefined
}

/** 澳門常見醫院名優先，其次通用「去／到 + 機構後綴」線索 */
const HOSPITAL_NAMES: readonly string[] = [
  '鏡湖醫院', '鏡湖', '山頂醫院', '山頂', '仁伯爵綜合醫院', '仁伯爵',
  '科大醫院', '離島醫療綜合醫院', '工人醫療所',
]

export function extractAppointmentLocation(text: string): string | undefined {
  if (!text) return undefined
  for (const name of HOSPITAL_NAMES) {
    if (text.includes(name)) return name
  }
  const generic = /(?:去|到|返|喺|在)\s*([^\s，。、！？]{0,6}?(?:醫院|診所|诊所|衛生中心|卫生中心|醫療中心|医疗中心|健康中心))/.exec(text)
  if (generic) return generic[1]
  return undefined
}

/** 科別詞典（覆診場景：「睇心臟科」「糖尿覆診」） */
const DEPARTMENT_TERMS: readonly { canonical: string; variants: string[] }[] = [
  { canonical: '糖尿病科', variants: ['糖尿病', '糖尿'] },
  { canonical: '心臟科', variants: ['心臟科', '心脏科', '心臟'] },
  { canonical: '骨科', variants: ['骨科'] },
  { canonical: '眼科', variants: ['眼科'] },
  { canonical: '內科', variants: ['內科', '内科'] },
  { canonical: '外科', variants: ['外科'] },
  { canonical: '皮膚科', variants: ['皮膚科', '皮肤科'] },
  { canonical: '耳鼻喉科', variants: ['耳鼻喉'] },
  { canonical: '腎科', variants: ['腎科', '肾科'] },
  { canonical: '精神科', variants: ['精神科'] },
  { canonical: '婦科', variants: ['婦科', '妇科'] },
  { canonical: '牙科', variants: ['牙科'] },
  { canonical: '普通科', variants: ['普通科'] },
]

export function extractDepartment(text: string): string | undefined {
  if (!text) return undefined
  for (const entry of DEPARTMENT_TERMS) {
    if (entry.variants.some((v) => text.includes(v))) return entry.canonical
  }
  return undefined
}

/** 覆診／預約抽取：要有覆診／預約線索先會啟動 */
export function extractAppointment(text: string, today: Date = new Date()): AppointmentInfo | undefined {
  if (!text) return undefined
  if (!/覆[診诊]|复诊|預約|预约|約咗|约了|約好|约好/.test(text)) return undefined

  const info: AppointmentInfo = {}
  const date = resolveRelativeDate(text, today)
  if (date) info.date = date
  const time = extractAppointmentTime(text)
  if (time) info.time = time
  const location = extractAppointmentLocation(text)
  if (location) info.location = location
  const department = extractDepartment(text)
  if (department) info.department = department
  // 醫生名：「睇／見／搵／約 X 醫生」（「睇醫生」冇名唔會誤抽）
  // 負向斷言排除助詞 咗／左／過：「約咗醫生」唔會把「咗」抽成醫生名
  const doctor = /(?:睇|見|搵|約|约)\s*((?:(?!咗|左|過)[A-Za-z\u4e00-\u9fff]){1,3})(?:醫生|医生)/.exec(text)
  if (doctor) info.doctor = doctor[1]

  return Object.keys(info).length > 0 ? info : undefined
}

/* ---------------------------------- 聯絡線索 ---------------------------------- */

const CONTACT_VERB_PATTERN = /搵|通知|聯絡|联系|打電話|打俾|打給|致電|致电|打[過个]去/i
const CONTACT_TARGET_PATTERN =
  /阿仔|阿女|阿孫|阿孙|個仔|個女|仔|女|孫|屋企人|家人|太太|老公|丈夫|妻子|老伴|監護人|监护人|照顧者|照顾者/

/** 聯絡家人線索：動詞（搵／通知／打電話俾…）+ 對象（屋企人／阿仔／監護人…） */
export function extractContactCue(text: string): boolean {
  if (!text) return false
  return CONTACT_VERB_PATTERN.test(text) && CONTACT_TARGET_PATTERN.test(text)
}

/* ---------------------------------- 日期／時間詞 ---------------------------------- */

const TIME_HINT_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  // 順序有講究：較具體嘅先匹配
  { pattern: /今朝早|今日朝早|今朝|今早|今天早上/, label: '今朝' },
  { pattern: /尋晚|昨晚|噚晚|昨天晚上/, label: '尋晚' },
  { pattern: /琴日|尋日|噚日|昨日|昨天/, label: '琴日' },
  { pattern: /聽日|聽朝|聽晚|明天|明日/, label: '聽日' },
  { pattern: /今日|今天|而家|依家/, label: '今日' },
  { pattern: /最近七日|近七日|近7日|最近一[週周]|近一[週周]|最近幾日|近排|最近/, label: '最近' },
]

/** 解析日期／時間詞為範圍提示（例：「尋晚」→ '尋晚'，「最近七日」→ '最近'） */
export function extractTimeHints(text: string): string[] {
  if (!text) return []
  const hints: string[] = []
  for (const { pattern, label } of TIME_HINT_PATTERNS) {
    if (pattern.test(text) && !hints.includes(label)) {
      hints.push(label)
    }
  }
  return hints
}

/* ---------------------------------- 總入口 ---------------------------------- */

export interface ExtractAllOptions {
  /** 相對日期（聽日／下星期三…）嘅解析基準日；預設 new Date()，測試可注入 */
  today?: Date
}

/** 一次過抽取所有結構化資料 */
export function extractAll(text: string, options: ExtractAllOptions = {}): ExtractionResult {
  const normalized = (text ?? '').trim()
  const medication = extractMedication(normalized)
  const dose = extractMedicationDose(normalized)
  const appointment = extractAppointment(normalized, options.today)
  const contactCue = extractContactCue(normalized)

  return {
    bloodPressure: extractBloodPressure(normalized),
    bloodGlucose: extractBloodGlucose(normalized),
    heartRate: extractHeartRate(normalized),
    weight: extractWeight(normalized),
    symptoms: extractSymptoms(normalized),
    medicationName: medication.name,
    medicationStatus: medication.status,
    ...(dose ? { medicationDoseAmount: dose.amount, medicationDoseUnit: dose.unit } : {}),
    ...(appointment ? { appointment } : {}),
    ...(contactCue ? { contactCue } : {}),
    timeHints: extractTimeHints(normalized),
  }
}

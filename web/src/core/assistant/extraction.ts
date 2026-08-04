/**
 * 結構化資料抽取（純函數，無外部依賴）。
 * 用正則 + 詞典做可泛化嘅抽取，支援粵語／口語／書面語多種寫法。
 */

export interface BloodPressureReading {
  systolic: number
  diastolic: number
}

export interface ExtractionResult {
  bloodPressure?: BloodPressureReading
  bloodGlucose?: number
  heartRate?: number
  weight?: number
  symptoms: string[]
  medicationName?: string
  medicationStatus?: 'taken' | 'missed' | 'late'
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
 * 「血壓155/92」「血壓係155上92落」「啱啱量到155 92」「高壓155低壓92」「收縮壓155舒張壓92」
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

  // 3) 收縮壓／舒張壓寫法（兩個標籤獨立出現）
  const systolicMatch = /收縮[壓壓]?\s*[:：]?\s*(\d{2,3})/.exec(text)
  const diastolicMatch = /舒張[壓壓]?\s*[:：]?\s*(\d{2,3})/.exec(text)
  if (systolicMatch && diastolicMatch) {
    const pair = normalizePair(Number(systolicMatch[1]), Number(diastolicMatch[1]))
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

/** 抽取心率（每分鐘下數），合理範圍 30–220 */
export function extractHeartRate(text: string): number | undefined {
  if (!text) return undefined
  const match = /(?:心跳|心率|脈搏|脉搏)\D{0,6}?(\d{2,3})/.exec(text)
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

/** 一次過抽取所有結構化資料 */
export function extractAll(text: string): ExtractionResult {
  const normalized = (text ?? '').trim()
  const medication = extractMedication(normalized)

  return {
    bloodPressure: extractBloodPressure(normalized),
    bloodGlucose: extractBloodGlucose(normalized),
    heartRate: extractHeartRate(normalized),
    weight: extractWeight(normalized),
    symptoms: extractSymptoms(normalized),
    medicationName: medication.name,
    medicationStatus: medication.status,
    timeHints: extractTimeHints(normalized),
  }
}

import { describe, expect, it } from 'vitest'
import {
  extractAll,
  extractBloodGlucose,
  extractBloodPressure,
  extractHeartRate,
  extractMedication,
  extractSymptoms,
  extractTimeHints,
  extractWeight,
} from '../extraction'

describe('extractBloodPressure', () => {
  it.each([
    ['血壓155/92', 155, 92],
    ['血壓係155上92落', 155, 92],
    ['啱啱量到155 92', 155, 92],
    ['高壓155低壓92', 155, 92],
    ['收縮壓155，舒張壓92', 155, 92],
    ['我今朝血壓 138/85', 138, 85],
    ['量度血壓：120、78', 120, 78],
  ])('「%s」→ %i/%i', (text, systolic, diastolic) => {
    expect(extractBloodPressure(text)).toEqual({ systolic, diastolic })
  })

  it('講反咗（舒張喺前）都會自動調返', () => {
    expect(extractBloodPressure('血壓92/155')).toEqual({ systolic: 155, diastolic: 92 })
  })

  it('超出合理範圍（收縮 60–260、舒張 30–160）唔會抽取', () => {
    expect(extractBloodPressure('血壓300/200')).toBeUndefined()
    expect(extractBloodPressure('血壓45/20')).toBeUndefined()
  })

  it('冇血壓資料時回傳 undefined', () => {
    expect(extractBloodPressure('今日天氣唔錯')).toBeUndefined()
  })
})

describe('extractBloodGlucose', () => {
  it.each([
    ['血糖8.1', 8.1],
    ['血糖係 8.1 mmol', 8.1],
    ['我今朝空腹血糖5.6', 5.6],
  ])('「%s」→ %f', (text, value) => {
    expect(extractBloodGlucose(text)).toBeCloseTo(value)
  })

  it('超出合理範圍唔會抽取', () => {
    expect(extractBloodGlucose('血糖88.1')).toBeUndefined()
  })
})

describe('extractHeartRate / extractWeight', () => {
  it('抽取心率', () => {
    expect(extractHeartRate('心跳每分鐘88下')).toBe(88)
    expect(extractHeartRate('心率係72')).toBe(72)
  })

  it('抽取體重（公斤與磅）', () => {
    expect(extractWeight('體重65.5公斤')).toBe(65.5)
    expect(extractWeight('我而家143磅')).toBeCloseTo(64.9, 1)
  })
})

describe('extractSymptoms（粵語變體映射）', () => {
  it('頭暈／暈 → 頭暈', () => {
    expect(extractSymptoms('我有啲頭暈')).toContain('頭暈')
    expect(extractSymptoms('好暈呀')).toContain('頭暈')
    expect(extractSymptoms('我有点头晕')).toContain('頭暈')
  })

  it('心口痛／胸口痛 → 胸痛', () => {
    expect(extractSymptoms('心口痛呀')).toContain('胸痛')
    expect(extractSymptoms('胸口痛')).toContain('胸痛')
  })

  it('多個症狀一次過抽取並去重', () => {
    const symptoms = extractSymptoms('我有啲頭暈同埋心口痛，仲有啲發燒')
    expect(symptoms).toContain('頭暈')
    expect(symptoms).toContain('胸痛')
    expect(symptoms).toContain('發燒')
    expect(symptoms.length).toBe(3)
  })

  it.each([
    ['覺得好攰', '疲勞'],
    ['瞓唔著', '失眠'],
    ['心悒呀', '心悸'],
    ['眼矇矇', '眼矇'],
    ['腳腫咗', '腳腫'],
    ['口好乾', '口渴'],
    ['個肚痛', '肚痛'],
    ['作嘔', '嘔吐'],
  ])('「%s」→ %s', (text, canonical) => {
    expect(extractSymptoms(text)).toContain(canonical)
  })

  it('冇症狀時回傳空陣列', () => {
    expect(extractSymptoms('今日幾開心')).toEqual([])
  })
})

describe('extractMedication', () => {
  it('「食咗降壓藥」→ taken + 降壓藥', () => {
    const info = extractMedication('我食咗降壓藥')
    expect(info.status).toBe('taken')
    expect(info.name).toBe('降壓藥')
    expect(info.mentioned).toBe(true)
  })

  it('「唔記得食藥」→ missed', () => {
    const info = extractMedication('我唔記得食藥')
    expect(info.status).toBe('missed')
    expect(info.mentioned).toBe(true)
  })

  it('「漏咗食降糖藥」→ missed + 降糖藥', () => {
    const info = extractMedication('漏咗食降糖藥')
    expect(info.status).toBe('missed')
    expect(info.name).toBe('降糖藥')
  })

  it('「遲咗食薄血藥」→ late', () => {
    const info = extractMedication('我遲咗食薄血藥')
    expect(info.status).toBe('late')
    expect(info.name).toBe('薄血藥')
  })

  it('書面語「忘记吃药」→ missed', () => {
    expect(extractMedication('忘记吃药了').status).toBe('missed')
  })
})

describe('extractTimeHints', () => {
  it('解析日期時間詞', () => {
    expect(extractTimeHints('今朝量咗血壓')).toContain('今朝')
    expect(extractTimeHints('尋晚瞓唔著')).toContain('尋晚')
    expect(extractTimeHints('琴日睇咗醫生')).toContain('琴日')
    expect(extractTimeHints('今日幾精神')).toContain('今日')
    expect(extractTimeHints('最近七日成日頭暈')).toContain('最近')
  })

  it('冇時間詞回傳空陣列', () => {
    expect(extractTimeHints('多謝你')).toEqual([])
  })
})

describe('extractAll', () => {
  it('一次過抽取多種資料', () => {
    const result = extractAll('我今朝量到血壓155/92，仲有啲頭暈，食咗降壓藥')
    expect(result.bloodPressure).toEqual({ systolic: 155, diastolic: 92 })
    expect(result.symptoms).toContain('頭暈')
    expect(result.medicationName).toBe('降壓藥')
    expect(result.medicationStatus).toBe('taken')
    expect(result.timeHints).toContain('今朝')
  })
})

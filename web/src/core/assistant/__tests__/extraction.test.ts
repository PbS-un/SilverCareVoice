import { describe, expect, it } from 'vitest'
import {
  extractAll,
  extractAppointment,
  extractAppointmentTime,
  extractBloodGlucose,
  extractBloodPressure,
  extractContactCue,
  extractDepartment,
  extractHeartRate,
  extractMedication,
  extractMedicationDose,
  extractSymptoms,
  extractTimeHints,
  extractWeight,
  resolveRelativeDate,
} from '../extraction'

describe('extractBloodPressure', () => {
  it.each([
    ['血壓155/92', 155, 92],
    ['血壓係155上92落', 155, 92],
    ['啱啱量到155 92', 155, 92],
    ['高壓155低壓92', 155, 92],
    ['上壓155下壓92', 155, 92],
    ['上壓 138，下壓 85', 138, 85],
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

  it('劑量抽取：「食咗降壓藥半粒」→ 0.5 粒', () => {
    const result = extractAll('我食咗降壓藥半粒')
    expect(result.medicationName).toBe('降壓藥')
    expect(result.medicationStatus).toBe('taken')
    expect(result.medicationDoseAmount).toBe(0.5)
    expect(result.medicationDoseUnit).toBe('粒')
  })
})

describe('extractMedicationDose（劑量抽取）', () => {
  it.each([
    ['食咗半粒安眠藥', 0.5, '粒'],
    ['食咗一粒降壓藥', 1, '粒'],
    ['食咗兩粒藥', 2, '粒'],
    ['食咗一粒半降糖藥', 1.5, '粒'],
    ['食5毫克薄血藥', 5, '毫克'],
    ['食咗30mg膽固醇藥', 30, 'mg'],
    ['飲10毫升藥水', 10, '毫升'],
    ['食三粒', 3, '粒'],
  ])('「%s」→ %s %s', (text, amount, unit) => {
    const dose = extractMedicationDose(text)
    expect(dose).toBeDefined()
    expect(dose?.amount).toBe(amount)
    expect(dose?.unit).toBe(unit)
  })

  it('冇劑量時回傳 undefined', () => {
    expect(extractMedicationDose('我食咗藥')).toBeUndefined()
    expect(extractMedicationDose('今日幾開心')).toBeUndefined()
  })
})

describe('resolveRelativeDate（相對日期 → ISO）', () => {
  // 固定基準日：2026-08-05（星期三）——確保測試唔受執行日期影響
  const TODAY = new Date(2026, 7, 5)

  it.each([
    ['聽日覆診', '2026-08-06'],
    ['明天覆診', '2026-08-06'],
    ['後日覆診', '2026-08-07'],
    ['今日覆診', '2026-08-05'],
    // 2026-08-05 係星期三：下星期三 = 下一個曆法週（8/10 起）嘅星期三
    ['下星期三覆診', '2026-08-12'],
    ['下個禮拜五覆診', '2026-08-14'],
    ['下星期日覆診', '2026-08-16'],
    ['下個月覆診', '2026-09-01'],
    ['下個月15號覆診', '2026-09-15'],
    ['下月3日覆診', '2026-09-03'],
    ['8月6號覆診', '2026-08-06'],
    // 跨年回滾：早於基準日 → 明年
    ['1月2日覆診', '2027-01-02'],
    ['8月4號覆診', '2027-08-04'],
  ])('「%s」→ %s', (text, expected) => {
    expect(resolveRelativeDate(text, TODAY)).toBe(expected)
  })

  it('D/M 寫法跨年回滾（2/1 喺 8 月講 → 明年 1 月 2 日）', () => {
    expect(resolveRelativeDate('2/1覆診', TODAY)).toBe('2027-01-02')
  })

  it('冇日期詞回傳 undefined', () => {
    expect(resolveRelativeDate('幾時覆診呀', TODAY)).toBeUndefined()
    expect(resolveRelativeDate('', TODAY)).toBeUndefined()
  })

  it('血壓斜線數值唔會被誤抽做日期', () => {
    expect(resolveRelativeDate('血壓155/92覆診', TODAY)).toBeUndefined()
  })
})

describe('extractAppointmentTime（時段／具體時間）', () => {
  it.each([
    ['下午三點', '15:00'],
    ['朝早九點', '09:00'],
    ['夜晚八點', '20:00'],
    ['十一點半', '11:30'],
    ['15:00', '15:00'],
    ['晏晝', '晏晝'],
    ['傍晚', '傍晚'],
    ['夜晚', '夜晚'],
    ['睡前', '睡前'],
    ['朝早', '朝早'],
  ])('「%s」→ %s', (text, expected) => {
    expect(extractAppointmentTime(text)).toBe(expected)
  })

  it('冇時間詞回傳 undefined', () => {
    expect(extractAppointmentTime('去鏡湖覆診')).toBeUndefined()
  })
})

describe('extractAppointment（覆診資訊抽取）', () => {
  const TODAY = new Date(2026, 7, 5)

  it('「下星期三下午三點去鏡湖覆診」→ 日期＋時間＋地點', () => {
    const appt = extractAppointment('下星期三下午三點去鏡湖覆診', TODAY)
    expect(appt).toEqual({ date: '2026-08-12', time: '15:00', location: '鏡湖' })
  })

  it('「聽日晏晝去衛生中心覆診」→ 聽日＋晏晝＋衛生中心', () => {
    const appt = extractAppointment('聽日晏晝去衛生中心覆診', TODAY)
    expect(appt?.date).toBe('2026-08-06')
    expect(appt?.time).toBe('晏晝')
    expect(appt?.location).toBe('衛生中心')
  })

  it('「後日睇心臟科覆診」→ 科別詞典', () => {
    const appt = extractAppointment('後日睇心臟科覆診', TODAY)
    expect(appt?.date).toBe('2026-08-07')
    expect(appt?.department).toBe('心臟科')
  })

  it('「聽日覆診睇陳醫生」→ 醫生名', () => {
    const appt = extractAppointment('聽日覆診睇陳醫生', TODAY)
    expect(appt?.doctor).toBe('陳')
  })

  it('冇覆診線索唔會抽取', () => {
    expect(extractAppointment('今日天氣唔錯', TODAY)).toBeUndefined()
  })

  it('「睇醫生」冇名唔會誤抽醫生', () => {
    const appt = extractAppointment('聽日覆診睇醫生', TODAY)
    expect(appt?.doctor).toBeUndefined()
  })
})

describe('extractDepartment（科別詞典）', () => {
  it.each([
    ['睇心臟科', '心臟科'],
    ['糖尿覆診', '糖尿病科'],
    ['骨科覆診', '骨科'],
  ])('「%s」→ %s', (text, expected) => {
    expect(extractDepartment(text)).toBe(expected)
  })
})

describe('extractContactCue（聯絡線索）', () => {
  it.each([
    '搵阿仔',
    '搵阿女',
    '搵屋企人',
    '搵我個仔',
    '通知監護人',
    '幫我打電話俾我個仔',
    '聯絡屋企人',
  ])('「%s」→ true', (text) => {
    expect(extractContactCue(text)).toBe(true)
  })

  it('冇聯絡對象／動詞 → false', () => {
    expect(extractContactCue('今日幾開心')).toBe(false)
    expect(extractContactCue('我想睇醫生')).toBe(false)
    expect(extractContactCue('我個仔幾時返嚟')).toBe(false)
  })
})

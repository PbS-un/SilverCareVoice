/**
 * HealthRuleEngine 測試（T10 補齊缺口）。
 *
 * 重點：連續 3 筆偏高嘅 trend 規則；另覆蓋血壓／血糖閾值、
 * 伴隨症狀、高風險症狀兜底、漏服關鍵藥物規則。
 * 純函數測試：唔依賴 DB。
 */
import { describe, expect, it } from 'vitest';

import { evaluate, type RuleInput } from '../HealthRuleEngine';
import type { Medication, MedicationLog, SymptomRecord, VitalRecord } from '../../../types/entities';

const ELDER_ID = 'elder-test';

/** 建一筆血壓 VitalRecord（measuredAt 用 offset 控制先後次序）。 */
function bp(
  id: string,
  systolic: number,
  diastolic: number,
  offsetHours = 0,
): VitalRecord {
  const t = new Date(Date.now() - offsetHours * 3_600_000).toISOString();
  return {
    id,
    elderId: ELDER_ID,
    type: 'blood_pressure',
    systolic,
    diastolic,
    unit: 'mmHg',
    measuredAt: t,
    source: 'text',
    createdAt: t,
    updatedAt: t,
  };
}

/** 建一筆血糖 VitalRecord。 */
function glucose(id: string, value: number): VitalRecord {
  const t = new Date().toISOString();
  return {
    id,
    elderId: ELDER_ID,
    type: 'blood_glucose',
    value,
    unit: 'mmol/L',
    measuredAt: t,
    source: 'text',
    createdAt: t,
    updatedAt: t,
  };
}

function symptom(id: string, symptoms: string[]): SymptomRecord {
  const t = new Date().toISOString();
  return {
    id,
    elderId: ELDER_ID,
    symptoms,
    description: symptoms.join('、'),
    severity: 'mild',
    occurredAt: t,
    createdAt: t,
    updatedAt: t,
  };
}

function medLog(id: string, status: MedicationLog['status']): MedicationLog {
  const t = new Date().toISOString();
  return {
    id,
    elderId: ELDER_ID,
    medicationId: 'med-x',
    scheduledAt: t,
    status,
    createdAt: t,
    updatedAt: t,
  };
}

function med(name: string): Medication {
  const t = new Date().toISOString();
  return {
    id: 'med-x',
    elderId: ELDER_ID,
    name,
    dosage: '每日一次',
    schedule: '早上 8 時',
    createdAt: t,
    updatedAt: t,
  };
}

describe('HealthRuleEngine — 血壓閾值', () => {
  it('SBP≥180 → bp_critical urgent', () => {
    const record = bp('new', 185, 95);
    const events = evaluate([{ kind: 'vital', record }], []);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('bp_critical');
    expect(events[0].severity).toBe('urgent');
    expect(events[0].summary).toContain('185/95');
  });

  it('DBP≥110 → bp_critical urgent', () => {
    const events = evaluate([{ kind: 'vital', record: bp('new', 150, 112) }], []);
    expect(events[0]?.type).toBe('bp_critical');
    expect(events[0]?.severity).toBe('urgent');
  });

  it('SBP≥160 → bp_high attention', () => {
    const events = evaluate([{ kind: 'vital', record: bp('new', 165, 88) }], []);
    expect(events[0]?.type).toBe('bp_high');
    expect(events[0]?.severity).toBe('attention');
  });

  it('DBP≥100 → bp_high attention', () => {
    const events = evaluate([{ kind: 'vital', record: bp('new', 138, 102) }], []);
    expect(events[0]?.type).toBe('bp_high');
  });

  it('偏高（≥140/90）+ 伴隨症狀 → bp_high_with_symptom attention', () => {
    const record = bp('new', 148, 88);
    const events = evaluate([{ kind: 'vital', record, concurrentSymptoms: ['頭暈'] }], []);
    expect(events[0]?.type).toBe('bp_high_with_symptom');
    expect(events[0]?.severity).toBe('attention');
    expect(events[0]?.summary).toContain('頭暈');
  });

  it('正常血壓 + 無症狀 → 冇事件', () => {
    const events = evaluate([{ kind: 'vital', record: bp('new', 122, 78) }], []);
    expect(events).toHaveLength(0);
  });

  it('偏高但冇症狀且未夠 3 筆 → 唔觸發任何規則', () => {
    const events = evaluate(
      [{ kind: 'vital', record: bp('new', 145, 92) }],
      [bp('h1', 150, 95, 48)],
    );
    expect(events).toHaveLength(0);
  });
});

describe('HealthRuleEngine — 連續 3 筆偏高 trend 規則', () => {
  it('歷史 2 筆偏高 + 新一筆偏高 → bp_trend_high attention，sourceRecordIds 包 3 筆', () => {
    const record = bp('new', 142, 88); // 本身未夠 bp_high 閾值
    const history = [bp('h1', 146, 92, 48), bp('h2', 151, 94, 24)];
    const events = evaluate([{ kind: 'vital', record }], history);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('bp_trend_high');
    expect(events[0].severity).toBe('attention');
    expect(events[0].sourceRecordIds).toHaveLength(3);
    expect(events[0].sourceRecordIds).toContain('new');
    expect(events[0].sourceRecordIds).toContain('h1');
    expect(events[0].sourceRecordIds).toContain('h2');
    expect(events[0].summary).toContain('142/88');
  });

  it('history 亂序傳入都正確（按 measuredAt 排）', () => {
    const record = bp('new', 145, 90);
    const history = [bp('h2', 148, 93, 24), bp('h1', 143, 91, 48)]; // 故意倒序
    const events = evaluate([{ kind: 'vital', record }], history);
    expect(events.some((e) => e.type === 'bp_trend_high')).toBe(true);
  });

  it('中間有一筆正常 → 唔觸發 trend', () => {
    const record = bp('new', 145, 92);
    const history = [bp('h1', 150, 95, 48), bp('h2', 118, 76, 24)];
    const events = evaluate([{ kind: 'vital', record }], history);
    expect(events.filter((e) => e.type === 'bp_trend_high')).toHaveLength(0);
  });

  it('只睇最近 3 筆：更早嘅正常記錄唔影響', () => {
    const record = bp('new', 144, 91);
    const history = [
      bp('h0', 110, 70, 72), // 更早一筆正常 → 唔入最近 3 筆
      bp('h1', 147, 93, 48),
      bp('h2', 149, 92, 24),
    ];
    const events = evaluate([{ kind: 'vital', record }], history);
    expect(events.some((e) => e.type === 'bp_trend_high')).toBe(true);
  });

  it('新記錄本身未達偏高（<140/90）→ 即使歷史偏高都唔觸發', () => {
    const record = bp('new', 128, 82);
    const history = [bp('h1', 148, 94, 48), bp('h2', 151, 95, 24)];
    const events = evaluate([{ kind: 'vital', record }], history);
    expect(events).toHaveLength(0);
  });

  it('history 混入其他類型 vital 唔會被計入 trend', () => {
    const record = bp('new', 146, 90);
    const history = [bp('h1', 149, 93, 48), glucose('g1', 6.2)];
    const events = evaluate([{ kind: 'vital', record }], history);
    expect(events.filter((e) => e.type === 'bp_trend_high')).toHaveLength(0);
  });
});

describe('HealthRuleEngine — 血糖', () => {
  it('≥13.9 → urgent', () => {
    const events = evaluate([{ kind: 'vital', record: glucose('g', 15.2) }], []);
    expect(events[0]?.type).toBe('glucose_critical_high');
    expect(events[0]?.severity).toBe('urgent');
  });

  it('≤3.9 → urgent', () => {
    const events = evaluate([{ kind: 'vital', record: glucose('g', 3.2) }], []);
    expect(events[0]?.type).toBe('glucose_critical_low');
    expect(events[0]?.severity).toBe('urgent');
  });

  it('≥11.1 → attention', () => {
    const events = evaluate([{ kind: 'vital', record: glucose('g', 12.0) }], []);
    expect(events[0]?.type).toBe('glucose_high');
    expect(events[0]?.severity).toBe('attention');
  });

  it('正常範圍 → 冇事件', () => {
    const events = evaluate([{ kind: 'vital', record: glucose('g', 6.1) }], []);
    expect(events).toHaveLength(0);
  });
});

describe('HealthRuleEngine — 症狀與服藥', () => {
  it('高風險症狀兜底 → urgent', () => {
    const events = evaluate([{ kind: 'symptom', record: symptom('s', ['胸悶', '氣促']) }], []);
    expect(events[0]?.type).toBe('symptom_high_risk');
    expect(events[0]?.severity).toBe('urgent');
  });

  it('一般症狀 → 冇事件', () => {
    const events = evaluate([{ kind: 'symptom', record: symptom('s', ['頭暈', '疲勞']) }], []);
    expect(events).toHaveLength(0);
  });

  it('漏服降壓藥 → medication_missed attention', () => {
    const events = evaluate(
      [{ kind: 'medication', log: medLog('l', 'missed'), medication: med('降壓藥') }],
      [],
    );
    expect(events[0]?.type).toBe('medication_missed');
    expect(events[0]?.severity).toBe('attention');
    expect(events[0]?.summary).toContain('降壓藥');
  });

  it('漏服降糖藥 → attention', () => {
    const events = evaluate(
      [{ kind: 'medication', log: medLog('l', 'missed'), medication: med('降糖藥') }],
      [],
    );
    expect(events[0]?.type).toBe('medication_missed');
  });

  it('漏服非關鍵藥物（止痛藥）→ 冇事件', () => {
    const events = evaluate(
      [{ kind: 'medication', log: medLog('l', 'missed'), medication: med('止痛藥') }],
      [],
    );
    expect(events).toHaveLength(0);
  });

  it('已服藥／遲服藥 → 唔觸發漏服規則', () => {
    const taken = evaluate(
      [{ kind: 'medication', log: medLog('l', 'taken'), medication: med('降壓藥') }],
      [],
    );
    const late = evaluate(
      [{ kind: 'medication', log: medLog('l', 'late'), medication: med('降壓藥') }],
      [],
    );
    expect(taken).toHaveLength(0);
    expect(late).toHaveLength(0);
  });
});

describe('HealthRuleEngine — 批量輸入', () => {
  it('空輸入 → 空事件', () => {
    expect(evaluate([], [])).toHaveLength(0);
  });

  it('同一批有症狀記錄時，血壓偏高即使冇 concurrentSymptoms 都算伴隨症狀', () => {
    const inputs: RuleInput[] = [
      { kind: 'vital', record: bp('new', 147, 91) },
      { kind: 'symptom', record: symptom('s', ['頭暈']) },
    ];
    const events = evaluate(inputs, []);
    expect(events.some((e) => e.type === 'bp_high_with_symptom')).toBe(true);
    // 頭暈唔係高風險症狀 → 冇 symptom_high_risk
    expect(events.some((e) => e.type === 'symptom_high_risk')).toBe(false);
  });
});

/**
 * T5 AssistantService 核心管線整合測試（純離線模式）
 *
 * 用 fake-indexeddb 起真 DB、攔截 fetch 令 probeProxy 失敗 →
 * 全部流量走 LocalHybridEngine，驗證「一句說話 → 寫庫 → 規則 → 提醒」全鏈路。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProvider } from '../../../data/DataProvider';
import { seedData } from '../../../data/seed';
import { tableNameOf } from '../../../types/entities';
import type {
  Alert,
  AuditLog,
  Conversation,
  HealthEvent,
  MedicationLog,
  SymptomRecord,
  VitalRecord,
} from '../../../types/entities';
import { ask } from '../AssistantService';
import { invalidateProbeCache } from '../DeepSeekClient';

const ELDER_ID = 'seed-elder-01';

const fetchMock = vi.fn(async () => {
  throw new Error('offline in test');
});

beforeEach(async () => {
  // 攔截 fetch：probeProxy 必然失敗 → 純本地引擎路徑
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  invalidateProbeCache();
  await getProvider().reset(seedData);
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateProbeCache();
});

/** 只取運行時新寫入（非 seed）嘅記錄。 */
function fresh<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((r) => !r.id.startsWith('seed-'));
}

describe('AssistantService — 血壓 + 症狀寫庫與規則提醒', () => {
  it('「我啱啱血壓158/95，仲有啲頭暈」→ VitalRecord 與 SymptomRecord 真寫入、attention 事件 + Alert', async () => {
    const res = await ask(ELDER_ID, '我啱啱血壓158/95，仲有啲頭暈');
    const provider = getProvider();

    // 1) 回覆與風險
    expect(res.answer).toContain('158/95');
    expect(res.riskLevel).toBe('attention');
    expect(res.provider).toBe('local');
    expect(res.intent).toBe('vital_record');

    // 2) VitalRecord 真寫入
    const vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    const bp = fresh(vitals).find((v) => v.systolic === 158 && v.diastolic === 95);
    expect(bp).toBeDefined();
    expect(bp!.type).toBe('blood_pressure');
    expect(bp!.unit).toBe('mmHg');
    expect(res.persisted[tableNameOf('VitalRecord')]).toContain(bp!.id);

    // 3) SymptomRecord 真寫入（頭暈）
    const symptoms = await provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), {
      elderId: ELDER_ID,
    });
    const sym = fresh(symptoms).find((s) => s.symptoms.includes('頭暈'));
    expect(sym).toBeDefined();

    // 4) 規則引擎產 attention HealthEvent
    const events = await provider.list<HealthEvent>(tableNameOf('HealthEvent'), {
      elderId: ELDER_ID,
    });
    const newEvents = fresh(events);
    expect(newEvents.length).toBeGreaterThanOrEqual(1);
    expect(newEvents.some((e) => e.severity === 'attention')).toBe(true);
    expect(res.eventId).toBe(newEvents[0].id);
    expect(newEvents[0].sourceRecordIds).toContain(bp!.id);

    // 5) Alert 建立（照顧者阿美、open、attention）
    const alerts = await provider.list<Alert>(tableNameOf('Alert'), { elderId: ELDER_ID });
    const newAlerts = fresh(alerts);
    expect(newAlerts.length).toBeGreaterThanOrEqual(1);
    expect(newAlerts[0].caregiverId).toBe('seed-caregiver-01');
    expect(newAlerts[0].status).toBe('open');
    expect(newAlerts[0].severity).toBe('attention');
    expect(newAlerts[0].message).toContain('陳婆婆');
    expect(res.alertId).toBe(newAlerts[0].id);
  });
});

describe('AssistantService — 服藥記錄', () => {
  it('「我今日食咗降壓藥」→ MedicationLog status taken（對應降壓藥）', async () => {
    const res = await ask(ELDER_ID, '我今日食咗降壓藥');
    const provider = getProvider();

    expect(res.intent).toBe('medication_taken');
    expect(res.riskLevel).toBe('normal');

    const logIds = res.persisted[tableNameOf('MedicationLog')] ?? [];
    expect(logIds.length).toBe(1);

    const log = await provider.get<MedicationLog>(tableNameOf('MedicationLog'), logIds[0]);
    expect(log).toBeDefined();
    expect(log!.medicationId).toBe('seed-med-01'); // 降壓藥
    expect(log!.status).toBe('taken');
    expect(log!.takenAt).toBeTruthy();

    // 冇觸發事件／提醒
    const events = await provider.list<HealthEvent>(tableNameOf('HealthEvent'), {
      elderId: ELDER_ID,
    });
    expect(fresh(events)).toHaveLength(0);
  });
});

describe('AssistantService — 健康紀錄查詢（真查 DB，動態答案）', () => {
  it('「最近七日血壓點樣」→ 答案含由 seed 數據實時計算嘅平均值', async () => {
    const res = await ask(ELDER_ID, '最近七日血壓點樣');
    const provider = getProvider();

    // 用同一窗口喺 DB 實時計算預期平均值（唔硬編碼數字）
    const now = Date.now();
    const from = new Date(now - 7 * 86_400_000).toISOString();
    const to = new Date(now).toISOString();
    const records = await provider.vitalsBetween(ELDER_ID, 'blood_pressure', from, to);
    expect(records.length).toBeGreaterThan(0);
    const sysAvg = Math.round(records.reduce((s, r) => s + (r.systolic ?? 0), 0) / records.length);
    const diaAvg = Math.round(records.reduce((s, r) => s + (r.diastolic ?? 0), 0) / records.length);

    expect(res.answer).toContain(`${sysAvg}/${diaAvg}`);
    expect(res.answer).toContain('血壓');
    // 查詢類唔應該寫入新 VitalRecord
    const vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals)).toHaveLength(0);
  });
});

describe('AssistantService — 高風險安全攔截（唔行 LLM）', () => {
  it('「我胸口突然好痛」→ urgent、Alert urgent、完全冇調 fetch', async () => {
    const res = await ask(ELDER_ID, '我胸口突然好痛');
    const provider = getProvider();

    expect(res.provider).toBe('safety');
    expect(res.intent).toBe('emergency');
    expect(res.riskLevel).toBe('urgent');
    expect(res.actions.some((a) => a.type === 'emergency_call')).toBe(true);
    // safety 路徑喺 probe 之前結束 → 一個網絡請求都冇
    expect(fetchMock).not.toHaveBeenCalled();

    // urgent HealthEvent + Alert
    const events = await provider.list<HealthEvent>(tableNameOf('HealthEvent'), {
      elderId: ELDER_ID,
    });
    const urgentEvents = fresh(events).filter((e) => e.severity === 'urgent');
    expect(urgentEvents.length).toBe(1);
    expect(urgentEvents[0].type).toBe('safety_screen');
    expect(res.eventId).toBe(urgentEvents[0].id);

    const alerts = await provider.list<Alert>(tableNameOf('Alert'), { elderId: ELDER_ID });
    const urgentAlerts = fresh(alerts).filter((a) => a.severity === 'urgent');
    expect(urgentAlerts.length).toBe(1);
    expect(urgentAlerts[0].status).toBe('open');
    expect(res.alertId).toBe(urgentAlerts[0].id);
  });
});

describe('AssistantService — 自由輸入兜底', () => {
  it('「我尋晚瞓得唔好，今朝個人好攰」→ 合理回應唔報錯，並記低症狀', async () => {
    const res = await ask(ELDER_ID, '我尋晚瞓得唔好，今朝個人好攰');
    const provider = getProvider();

    expect(res.answer.length).toBeGreaterThan(0);
    expect(res.riskLevel).toBe('normal');

    const symptoms = await provider.list<SymptomRecord>(tableNameOf('SymptomRecord'), {
      elderId: ELDER_ID,
    });
    const newSym = fresh(symptoms).find(
      (s) => s.symptoms.includes('失眠') || s.symptoms.includes('疲勞'),
    );
    expect(newSym).toBeDefined();
  });

  it('完全離題輸入都有回應（wellbeing note），唔報錯', async () => {
    const res = await ask(ELDER_ID, '今日天氣幾好，去咗公園行吓');
    expect(res.answer.length).toBeGreaterThan(0);
    expect(res.provider).toBe('local');
  });

  it('每次 ask 都會寫 user + assistant Conversation 與 AuditLog', async () => {
    await ask(ELDER_ID, '我今日食咗降壓藥');
    const provider = getProvider();
    const convs = await provider.list<Conversation>(tableNameOf('Conversation'), {
      elderId: ELDER_ID,
    });
    const newConvs = fresh(convs);
    expect(newConvs.some((c) => c.role === 'elder')).toBe(true);
    expect(newConvs.some((c) => c.role === 'assistant')).toBe(true);

    const audits = await provider.list<AuditLog>(tableNameOf('AuditLog'), { actor: ELDER_ID });
    expect(fresh(audits).length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * T16 執行門控矩陣單元測試（純離線模式）。
 *
 * 覆蓋：完整→執行／不完整→追問／模糊→候選／無匹配→提議新增／
 * 覆診確認往返／家人聯絡卡／pending 合併總則（確認詞、取消詞、
 * 新內容清除、輪數上限）。fake-indexeddb 真 DB + 攔截 fetch 行本地引擎。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProvider } from '../../../data/DataProvider';
import { seedData } from '../../../data/seed';
import { tableNameOf } from '../../../types/entities';
import type {
  Alert,
  Appointment,
  HealthEvent,
  Medication,
  MedicationLog,
  VitalRecord,
} from '../../../types/entities';
import { resolveRelativeDate } from '../extraction';
import { ask, type PendingAction } from '../AssistantService';
import { invalidateProbeCache } from '../DeepSeekClient';
import { createMedication } from '../../../lib/manualEntry';

const ELDER_ID = 'seed-elder-01';
/** 獨立長者（自訂藥物名單，測候選分級用）。 */
const GATE_ELDER_ID = 'gate-elder-01';

const fetchMock = vi.fn(async () => {
  throw new Error('offline in test');
});

beforeEach(async () => {
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

describe('執行門控 — 血壓', () => {
  it('完整血壓「我啱啱血壓138/82」（source voice）→ 直接寫入 VitalRecord', async () => {
    const res = await ask(ELDER_ID, '我啱啱血壓138/82', { source: 'voice' });
    const provider = getProvider();

    expect(res.answer).toContain('138/82');
    expect(res.pending).toBeUndefined();

    const vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    const bp = fresh(vitals).find((v) => v.systolic === 138 && v.diastolic === 82);
    expect(bp).toBeDefined();
    expect(bp!.source).toBe('voice');
    expect(bp!.type).toBe('blood_pressure');
  });

  it('「我要記血壓」（冇數值）→ 追問、唔寫入、pending fill_bp；下一輪純數字填槽執行', async () => {
    const res = await ask(ELDER_ID, '我要記血壓');
    const provider = getProvider();

    expect(res.answer).toContain('上壓');
    expect(res.answer).toContain('下壓');
    expect(res.pending?.kind).toBe('fill_bp');
    let vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals)).toHaveLength(0);

    // 下一輪純數字 → 填槽執行
    const res2 = await ask(ELDER_ID, '138 82', { pending: res.pending, source: 'voice' });
    expect(res2.answer).toContain('138/82');
    expect(res2.pending).toBeUndefined();
    vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    const bp = fresh(vitals).find((v) => v.systolic === 138 && v.diastolic === 82);
    expect(bp).toBeDefined();
    expect(bp!.source).toBe('voice');
  });

  it('只講一邊「上壓140」→ 追問另一邊（絕不猜）；「下壓90」→ 寫入 140/90', async () => {
    const res = await ask(ELDER_ID, '我上壓140');
    expect(res.pending?.kind).toBe('fill_bp');
    if (res.pending?.kind === 'fill_bp') {
      expect(res.pending.partial.systolic).toBe(140);
      expect(res.pending.partial.diastolic).toBeUndefined();
    }
    expect(res.answer).toContain('下壓');

    const provider = getProvider();
    const res2 = await ask(ELDER_ID, '下壓90', { pending: res.pending });
    expect(res2.answer).toContain('140/90');
    const vitals = await provider.list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals).some((v) => v.systolic === 140 && v.diastolic === 90)).toBe(true);
  });

  it('fill_bp pending 下講「唔使」→ 取消，唔寫入', async () => {
    const res = await ask(ELDER_ID, '我要記血壓');
    expect(res.pending?.kind).toBe('fill_bp');

    const res2 = await ask(ELDER_ID, '唔使', { pending: res.pending });
    expect(res2.pending).toBeUndefined();
    const vitals = await getProvider().list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals)).toHaveLength(0);
  });

  it('pending 輪數上限（turns ≥ 2）→ 清除 pending 當新查詢', async () => {
    const first = await ask(ELDER_ID, '我要記血壓');
    expect(first.pending?.kind).toBe('fill_bp');
    // 模擬已追問兩輪
    const pending = { ...(first.pending as { kind: 'fill_bp'; partial: {}; turns: number }), turns: 2 };
    const res = await ask(ELDER_ID, '138 82', { pending });
    expect(res.pending).toBeUndefined();
    // 上限清除後當新查詢：唔應該填槽寫入
    const vitals = await getProvider().list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals)).toHaveLength(0);
  });

  it('pending 期間講全新內容 → 清 pending 當新查詢（完整血壓照執行）', async () => {
    const res = await ask(ELDER_ID, '我要記血壓');
    expect(res.pending?.kind).toBe('fill_bp');

    const res2 = await ask(ELDER_ID, '我啱啱血壓120/80', { pending: res.pending });
    expect(res2.answer).toContain('120/80');
    const vitals = await getProvider().list<VitalRecord>(tableNameOf('VitalRecord'), {
      elderId: ELDER_ID,
    });
    expect(fresh(vitals).some((v) => v.systolic === 120 && v.diastolic === 80)).toBe(true);
  });
});

describe('執行門控 — 藥物', () => {
  it('模糊（多候選）→ 唔寫入，回 candidates + pending；下一輪講明藥名 → 記錄', async () => {
    const provider = getProvider();
    // 兩個候選都「包含」查詢詞（contains 弱級、多項）→ matchMedications 低置信
    const t = new Date().toISOString();
    const mk = (id: string, name: string): Medication => ({
      id,
      elderId: GATE_ELDER_ID,
      name,
      dosage: '1 粒',
      schedule: '每朝 8 時',
      createdAt: t,
      updatedAt: t,
    });
    await provider.put(tableNameOf('Medication'), mk('gate-med-a', '特效薄血藥丸'));
    await provider.put(tableNameOf('Medication'), mk('gate-med-b', '長效薄血藥片'));

    const res = await ask(GATE_ELDER_ID, '我食咗薄血藥');
    expect(res.candidates?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['特效薄血藥丸', '長效薄血藥片']),
    );
    expect(res.pending?.kind).toBe('med_candidates');
    expect(res.answer).toContain('特效薄血藥丸');
    let logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: GATE_ELDER_ID,
    });
    expect(logs).toHaveLength(0);

    // 下一輪講明邊一隻 → 記錄
    const res2 = await ask(GATE_ELDER_ID, '特效薄血藥丸', { pending: res.pending });
    expect(res2.answer).toContain('特效薄血藥丸');
    expect(res2.pending).toBeUndefined();
    logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: GATE_ELDER_ID,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].medicationId).toBe('gate-med-a');
    expect(logs[0].status).toBe('taken');
  });

  it('候選第二輪序數選擇「第一個」→ 記錄第一個候選，且回覆覆述劑量', async () => {
    const provider = getProvider();
    const t = new Date().toISOString();
    const mk = (id: string, name: string): Medication => ({
      id,
      elderId: GATE_ELDER_ID,
      name,
      dosage: '1 粒',
      schedule: '每朝 8 時',
      createdAt: t,
      updatedAt: t,
    });
    await provider.put(tableNameOf('Medication'), mk('gate-med-a', '特效薄血藥丸'));
    await provider.put(tableNameOf('Medication'), mk('gate-med-b', '長效薄血藥片'));

    const res = await ask(GATE_ELDER_ID, '我食咗一粒薄血藥');
    expect(res.pending?.kind).toBe('med_candidates');
    if (res.pending?.kind === 'med_candidates') {
      // 劑量隨 pending 帶到第二輪
      expect(res.pending.doseAmount).toBe(1);
      expect(res.pending.doseUnit).toBe('粒');
    }

    const res2 = await ask(GATE_ELDER_ID, '第一個', { pending: res.pending });
    expect(res2.pending).toBeUndefined();
    expect(res2.answer).toContain('特效薄血藥丸');
    // C4：候選路徑與直寫路徑同一組句（medRecordAnswer），劑量一併覆述
    expect(res2.answer).toContain('記低咗');
    expect(res2.answer).toContain('1 粒');

    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: GATE_ELDER_ID,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].medicationId).toBe('gate-med-a');
    expect(logs[0].status).toBe('taken');
  });

  it('序數超出範圍「第五個」→ fallthrough 當新查詢，唔寫入', async () => {
    const provider = getProvider();
    const t = new Date().toISOString();
    const mk = (id: string, name: string): Medication => ({
      id,
      elderId: GATE_ELDER_ID,
      name,
      dosage: '1 粒',
      schedule: '每朝 8 時',
      createdAt: t,
      updatedAt: t,
    });
    await provider.put(tableNameOf('Medication'), mk('gate-med-a', '特效薄血藥丸'));
    await provider.put(tableNameOf('Medication'), mk('gate-med-b', '長效薄血藥片'));

    const res = await ask(GATE_ELDER_ID, '我食咗薄血藥');
    expect(res.pending?.kind).toBe('med_candidates');

    await ask(GATE_ELDER_ID, '第五個', { pending: res.pending });
    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: GATE_ELDER_ID,
    });
    expect(logs).toHaveLength(0);
  });

  it('完全冇匹配「我食咗一粒拜新同」→ 提議新增（唔靜默建藥）', async () => {
    const res = await ask(ELDER_ID, '我食咗一粒拜新同');
    const provider = getProvider();

    expect(res.pending?.kind).toBe('confirm_new_med');
    if (res.pending?.kind === 'confirm_new_med') {
      expect(res.pending.payload.name).toBe('拜新同');
      expect(res.pending.payload.status).toBe('taken');
    }
    expect(res.openForm?.form).toBe('medication');
    expect(res.answer).toContain('要唔要');

    const meds = await provider.list<Medication>(tableNameOf('Medication'), {
      elderId: ELDER_ID,
    });
    expect(fresh(meds)).toHaveLength(0);
  });

  it('新藥確認 pending 下講「好呀」→ createMedication + MedicationLog taken', async () => {
    const res = await ask(ELDER_ID, '我食咗一粒拜新同');
    expect(res.pending?.kind).toBe('confirm_new_med');

    const res2 = await ask(ELDER_ID, '好呀', { pending: res.pending });
    const provider = getProvider();
    expect(res2.answer).toContain('拜新同');

    const meds = await provider.list<Medication>(tableNameOf('Medication'), {
      elderId: ELDER_ID,
    });
    const newMed = fresh(meds).find((m) => m.name === '拜新同');
    expect(newMed).toBeDefined();

    const logs = await provider.list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: ELDER_ID,
      medicationId: newMed!.id,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.status === 'taken')).toBe(true);
  });

  it('新藥確認 pending 下講「唔使」→ 取消，唔建藥', async () => {
    const res = await ask(ELDER_ID, '我食咗一粒拜新同');
    expect(res.pending?.kind).toBe('confirm_new_med');

    const res2 = await ask(ELDER_ID, '唔使', { pending: res.pending });
    expect(res2.pending).toBeUndefined();
    const meds = await getProvider().list<Medication>(tableNameOf('Medication'), {
      elderId: ELDER_ID,
    });
    expect(fresh(meds)).toHaveLength(0);
  });

  it('提議新增後用戶經表單自建藥物，再講同一句 → 高置信直寫＋答「記低咗」', async () => {
    const res = await ask(ELDER_ID, '我食咗一粒拜新同');
    expect(res.pending?.kind).toBe('confirm_new_med');

    // 模擬「改一改／開表單」路徑：用戶自己建咗呢隻藥
    const med = await createMedication(getProvider(), ELDER_ID, {
      name: '拜新同',
      dosage: '',
      schedule: '而家',
    });

    const res2 = await ask(ELDER_ID, '我食咗一粒拜新同', { pending: res.pending });
    expect(res2.answer).toContain('記低咗');
    expect(res2.answer).toContain('拜新同');
    expect(res2.pending).toBeUndefined();

    const logs = await getProvider().list<MedicationLog>(tableNameOf('MedicationLog'), {
      elderId: ELDER_ID,
      medicationId: med.id,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.status === 'taken')).toBe(true);
  });
});

describe('執行門控 — 覆診', () => {
  it('「下星期三下午三點去鏡湖覆診」→ 確認卡、未寫入；「啱」→ 寫入 Appointment', async () => {
    const res = await ask(ELDER_ID, '下星期三下午三點去鏡湖覆診');
    const provider = getProvider();

    expect(res.confirmation?.kind).toBe('appointment');
    expect(res.pending?.kind).toBe('confirm_appointment');
    expect(res.answer).toContain('啱唔啱');
    expect(res.confirmation!.summary ?? res.answer).toContain('鏡湖');

    // 未寫入
    let appts = await provider.list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    expect(fresh(appts)).toHaveLength(0);

    // 確認後寫入
    const res2 = await ask(ELDER_ID, '啱', { pending: res.pending });
    expect(res2.answer).toContain('鏡湖');
    appts = await provider.list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    const saved = fresh(appts);
    expect(saved).toHaveLength(1);
    expect(saved[0].location).toBe('鏡湖');
    expect(saved[0].timeTbd).toBeFalsy();

    // 日期 = 下星期三，時間 = 15:00（下午三點）
    const expectedDate = resolveRelativeDate('下星期三');
    expect(expectedDate).toBeDefined();
    const local = new Date(saved[0].date);
    expect(local.getHours()).toBe(15);
    expect(local.getMinutes()).toBe(0);
  });

  it('無具體時間「下星期三去鏡湖覆診」→ 確認後 timeTbd:true、當日 T00:00', async () => {
    const res = await ask(ELDER_ID, '下星期三去鏡湖覆診');
    expect(res.pending?.kind).toBe('confirm_appointment');
    if (res.pending?.kind === 'confirm_appointment') {
      expect(res.pending.payload.timeTbd).toBe(true);
    }

    const res2 = await ask(ELDER_ID, '啱呀', { pending: res.pending });
    expect(res2.answer.length).toBeGreaterThan(0);
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    const saved = fresh(appts);
    expect(saved).toHaveLength(1);
    expect(saved[0].timeTbd).toBe(true);
    const local = new Date(saved[0].date);
    expect(local.getHours()).toBe(0);
    expect(local.getMinutes()).toBe(0);
  });

  it('C6 迴歸：草稿同時帶 time 與 timeTbd:true → 確認後以鐘點為準（唔寫 timeTbd）', async () => {
    // provider 可能回傳 time:'15:00' 與 timeTbd:true 並存；寫入路徑必須
    // 以鐘點為準組 `${date}T${time}:00`，唔可以寫成「時間未定」
    const date = resolveRelativeDate('下星期三');
    expect(date).toBeDefined();
    const pending: PendingAction = {
      kind: 'confirm_appointment',
      payload: { date: date!, time: '15:00', location: '鏡湖', timeTbd: true },
      turns: 0,
    };

    const res = await ask(ELDER_ID, '啱', { pending });
    expect(res.answer).toContain('記低咗');
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    const saved = fresh(appts);
    expect(saved).toHaveLength(1);
    expect(saved[0].timeTbd).toBeFalsy();
    const local = new Date(saved[0].date);
    expect(local.getHours()).toBe(15);
    expect(local.getMinutes()).toBe(0);
  });

  it('確認 pending 下講「唔啱」→ 唔寫入，提議開覆診表單（帶預填）', async () => {
    const res = await ask(ELDER_ID, '下星期三下午三點去鏡湖覆診');
    expect(res.pending?.kind).toBe('confirm_appointment');

    const res2 = await ask(ELDER_ID, '唔啱', { pending: res.pending });
    expect(res2.openForm?.form).toBe('appointment');
    expect(res2.openForm?.prefill?.location).toBe('鏡湖');
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    expect(fresh(appts)).toHaveLength(0);
  });

  it('date 同 location 都缺「我要記覆診」→ 追問最少必要資料，唔寫入', async () => {
    const res = await ask(ELDER_ID, '我要記覆診');
    expect(res.answer).toContain('幾時');
    expect(res.confirmation).toBeUndefined();
    expect(res.pending).toBeUndefined();
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    expect(fresh(appts)).toHaveLength(0);
  });
});

describe('執行門控 — 家人聯絡', () => {
  it('「搵我個女」→ 聯絡卡（阿美／女兒／電話），唔寫入', async () => {
    const res = await ask(ELDER_ID, '搵我個女');
    expect(res.contactCard).toBeDefined();
    expect(res.contactCard!.length).toBe(1);
    expect(res.contactCard![0].name).toBe('阿美');
    expect(res.contactCard![0].relation).toBe('女兒');
    expect(res.contactCard![0].phone).toBe('+85362000002');
    expect(res.pending).toBeUndefined();

    const events = await getProvider().list<HealthEvent>(tableNameOf('HealthEvent'), {
      elderId: ELDER_ID,
    });
    expect(fresh(events)).toHaveLength(0);
  });

  it('稱謂配唔到（「搵我個仔」）→ 列全部 consentGiven 照顧者', async () => {
    const res = await ask(ELDER_ID, '搵我個仔');
    expect(res.contactCard).toBeDefined();
    expect(res.contactCard!.length).toBe(1); // seed 只有阿美
    expect(res.contactCard![0].name).toBe('阿美');
  });

  it('「通知阿美我唔舒服」→ 直接 notifyFamily（HealthEvent + Alert）', async () => {
    const res = await ask(ELDER_ID, '通知阿美我唔舒服');
    const provider = getProvider();

    expect(res.answer).toContain('通知');
    expect(res.contactCard).toBeUndefined();
    expect(res.eventId).toBeDefined();

    const events = await provider.list<HealthEvent>(tableNameOf('HealthEvent'), {
      elderId: ELDER_ID,
    });
    expect(fresh(events).length).toBeGreaterThanOrEqual(1);
    const alerts = await provider.list<Alert>(tableNameOf('Alert'), { elderId: ELDER_ID });
    expect(fresh(alerts).length).toBeGreaterThanOrEqual(1);
  });
});

describe('執行門控 — 覆診：DeepSeek 缺 date（雲端回歸矩陣）', () => {
  /**
   * 攔截 fetch 模擬雲端路徑：probe 可達 + /api/ai/chat 回 deepseek analysis，
   * extractedData.appointment 故意唔帶（或帶非 ISO）date —— 對齊真實 DeepSeek
   * 對「下星期三下午三點去鏡湖覆診」嘅回傳形狀。
   */
  function stubDeepSeekAppointment(appointment: Record<string, unknown>): void {
    const mock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('/api/ai/chat')) {
        return new Response(
          JSON.stringify({
            provider: 'deepseek',
            analysis: {
              intent: 'appointment_query',
              riskLevel: 'normal',
              answer: '好嘅，幫你記低覆診。',
              extractedData: { appointment },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });
    vi.stubGlobal('fetch', mock);
    invalidateProbeCache();
  }

  /** Appointment.date（UTC ISO）轉本地日期鍵比較。 */
  function localKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  it('缺 date＋原文有相對詞 → 門控補解析；確認卡帶日期；「啱」寫入 15:00', async () => {
    stubDeepSeekAppointment({ location: '鏡湖', time: '15:00' });
    const res = await ask(ELDER_ID, '下星期三下午三點去鏡湖覆診');
    const expected = resolveRelativeDate('下星期三');
    expect(expected).toBeDefined();

    expect(res.provider).toBe('deepseek');
    expect(res.pending?.kind).toBe('confirm_appointment');
    if (res.pending?.kind === 'confirm_appointment') {
      expect(res.pending.payload.date).toBe(expected);
      expect(res.pending.payload.time).toBe('15:00');
    }
    // 確認卡文案必須包含日期（長者核對用）
    expect(res.confirmation?.kind).toBe('appointment');
    expect(res.answer).toContain(`${Number(expected!.slice(5, 7))}月${Number(expected!.slice(8, 10))}日`);
    expect(res.answer).toContain('鏡湖');

    const res2 = await ask(ELDER_ID, '啱', { pending: res.pending });
    expect(res2.answer).toContain('記低咗');
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    const saved = fresh(appts);
    expect(saved).toHaveLength(1);
    expect(saved[0].location).toBe('鏡湖');
    expect(saved[0].timeTbd).toBeFalsy(); // C6：有鐘點必唔寫 timeTbd
    expect(localKey(saved[0].date)).toBe(expected);
    const local = new Date(saved[0].date);
    expect(local.getHours()).toBe(15);
    expect(local.getMinutes()).toBe(0);
  });

  it('缺 date＋原文冇日期線索 → 追問「幾號」填槽；答「下星期三」再確認；「啱」寫入', async () => {
    stubDeepSeekAppointment({ location: '鏡湖', time: '15:00' });
    const res = await ask(ELDER_ID, '去鏡湖覆診');
    expect(res.provider).toBe('deepseek');
    expect(res.answer).toContain('幾號');
    expect(res.confirmation).toBeUndefined();
    expect(res.pending?.kind).toBe('confirm_appointment');
    if (res.pending?.kind === 'confirm_appointment') {
      expect(res.pending.payload.date).toBeUndefined();
      expect(res.pending.payload.location).toBe('鏡湖');
    }
    // 未寫入
    let appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    expect(fresh(appts)).toHaveLength(0);

    // 日期回答 → 補槽並回確認卡（唔跳過確認直寫）
    const expected = resolveRelativeDate('下星期三');
    const res2 = await ask(ELDER_ID, '下星期三', { pending: res.pending });
    expect(res2.confirmation?.kind).toBe('appointment');
    expect(res2.answer).toContain('啱唔啱');
    if (res2.pending?.kind === 'confirm_appointment') {
      expect(res2.pending.payload.date).toBe(expected);
    }

    const res3 = await ask(ELDER_ID, '啱', { pending: res2.pending });
    expect(res3.answer).toContain('記低咗');
    appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    const saved = fresh(appts);
    expect(saved).toHaveLength(1);
    expect(localKey(saved[0].date)).toBe(expected);
    expect(saved[0].timeTbd).toBeFalsy();
  });

  it('日期回答解析唔到 → 再追問一次；超輪數上限 → 開表單兜底（絕不靜默失敗）', async () => {
    stubDeepSeekAppointment({ location: '鏡湖' });
    const res = await ask(ELDER_ID, '去鏡湖覆診');
    expect(res.pending?.kind).toBe('confirm_appointment');

    const res2 = await ask(ELDER_ID, '遲啲先話你知', { pending: res.pending });
    expect(res2.answer).toContain('幾號');
    expect(res2.pending?.kind).toBe('confirm_appointment');
    if (res2.pending?.kind === 'confirm_appointment') {
      expect(res2.pending.turns).toBe(1);
    }

    const res3 = await ask(ELDER_ID, '都係唔記得', { pending: res2.pending });
    expect(res3.openForm?.form).toBe('appointment');
    expect(res3.pending).toBeUndefined();
    const appts = await getProvider().list<Appointment>(tableNameOf('Appointment'), {
      elderId: ELDER_ID,
    });
    expect(fresh(appts)).toHaveLength(0);
  });

  it('DeepSeek 回非 ISO date（相對詞原文）→ 門控照樣本地補解析成 ISO', async () => {
    stubDeepSeekAppointment({ date: '下星期三', location: '鏡湖', time: '15:00' });
    const res = await ask(ELDER_ID, '下星期三下午三點去鏡湖覆診');
    const expected = resolveRelativeDate('下星期三');
    if (res.pending?.kind === 'confirm_appointment') {
      expect(res.pending.payload.date).toBe(expected);
    } else {
      throw new Error('expected confirm_appointment pending');
    }
  });
});

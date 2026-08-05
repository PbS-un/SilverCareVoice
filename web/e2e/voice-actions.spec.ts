/**
 * T16 E2E：語音「講一句直接完成」執行門控 + 長者 UI。
 *
 * 離線確定性：playwright.config 強制 DEEPSEEK_API_KEY='' → server 一律回
 * provider:'local'，客戶端確定性行 LocalHybridEngine，以下全部場景都係
 * 本地引擎路徑（「離線核心語音仍可用」亦由此覆蓋）。
 *
 * DB 驗證：直接讀 IndexedDB（silvercare-db），避免依賴間接 UI 口徑。
 */
import { test, expect, type Page } from '@playwright/test';

import { bypassConsent, askElder } from './helpers';

test.beforeEach(async ({ page }) => {
  await bypassConsent(page);
});

async function gotoElder(page: Page): Promise<void> {
  await page.goto('/#/elder');
  await expect(page.getByTestId('text-input')).toBeVisible({ timeout: 30_000 });
}

/** 直接讀 IndexedDB 某表全部行（過濾已刪）。 */
async function dbTable<T extends { id: string }>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (t) => {
    return new Promise<T[]>((resolve, reject) => {
      const req = indexedDB.open('silvercare-db');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(t)) {
          resolve([]);
          return;
        }
        const all = db.transaction(t, 'readonly').objectStore(t).getAll();
        all.onsuccess = () => {
          const rows = (all.result as Array<T & { deletedAt?: string }>).filter((r) => !r.deletedAt);
          resolve(rows);
        };
        all.onerror = () => reject(all.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, table);
}

/** 只取運行時新寫入（非 seed）嘅行。 */
function fresh<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((r) => !r.id.startsWith('seed-'));
}

interface VitalRow {
  id: string;
  type: string;
  systolic?: number;
  diastolic?: number;
  source?: string;
}
interface MedRow {
  id: string;
  name: string;
}
interface LogRow {
  id: string;
  medicationId: string;
  status: string;
}
interface ApptRow {
  id: string;
  date: string;
  location: string;
  timeTbd?: boolean;
}

/* ────────────────── 1. textarea ────────────────── */

test('文字輸入係 textarea 且 placeholder 有完整例句', async ({ page }) => {
  await gotoElder(page);
  const input = page.getByTestId('text-input');
  await expect(input).toBeVisible();
  expect(await input.evaluate((el) => el.tagName)).toBe('TEXTAREA');
  await expect(input).toHaveAttribute('placeholder', /我啱啱量血壓 138\/82/);
});

/* ────────────────── 2. 血壓完整句直接寫入 ────────────────── */

test('語音句1：「我啱啱血壓138/82」→ 直接寫入 VitalRecord（source=voice）', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  const before = fresh(await dbTable<VitalRow>(page, 'vitalRecords'));

  // text-input 發送（等同語音結果）；source 經 mic 先係 voice，
  // 呢度用文字路徑驗證門控寫入（門控與 source 無關）
  const bubble = await askElder(page, '我啱啱血壓138/82');
  await expect(bubble).toContainText('138/82');

  const rows = fresh(await dbTable<VitalRow>(page, 'vitalRecords')).filter(
    (r) => !before.some((b) => b.id === r.id),
  );
  expect(rows.length).toBeGreaterThan(0);
  const bp = rows.find((r) => r.type === 'blood_pressure');
  expect(bp, '應寫入一筆 blood_pressure VitalRecord').toBeTruthy();
  expect(bp!.systolic).toBe(138);
  expect(bp!.diastolic).toBe(82);
});

/* ────────────────── 3. 新藥：提議新增 → 建藥後語音記 taken ────────────────── */

test('語音句2：「我食咗一粒拜新同」→ 無匹配提議新增；建藥後再講 → MedicationLog taken', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  // 第一輪：冇呢隻藥 → 提議新增，絕不靜靜寫入
  const bubble = await askElder(page, '我食咗一粒拜新同');
  await expect(bubble).toContainText('要唔要');
  await expect(page.getByTestId('open-form-medication')).toBeVisible();
  expect(fresh(await dbTable<MedRow>(page, 'medications')).find((m) => m.name === '拜新同')).toBeUndefined();

  // 經提議掣開「記錄食藥」Modal（帶搜尋字預填）→ 就地新增拜新同 → 記「已服」
  await page.getByTestId('open-form-medication').click();
  const searchInput = page.getByTestId('med-search-input');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveValue('拜新同');
  await searchInput.click();
  await page.getByTestId('med-search-create').click();
  await expect(page.getByTestId('med-new-name-input')).toHaveValue('拜新同');
  await page.getByTestId('med-taken').click();
  await expect(page.getByRole('status')).toContainText('已記低');

  const meds = fresh(await dbTable<MedRow>(page, 'medications'));
  const med = meds.find((m) => m.name === '拜新同');
  expect(med, 'Modal 應已建立拜新同').toBeTruthy();
  const logs = fresh(await dbTable<LogRow>(page, 'medicationLogs'));
  expect(logs.some((l) => l.medicationId === med!.id && l.status === 'taken')).toBe(true);

  // 第二輪：而家有呢隻藥 → 高置信單一匹配 → 直接記錄
  // （writeMedicationLog 會復用同日最近一筆 log 翻轉狀態，唔會重複開行）
  const bubble2 = await askElder(page, '我食咗一粒拜新同');
  await expect(bubble2).toContainText('記低咗');
  await expect(bubble2).toContainText('拜新同');
  const logs2 = fresh(await dbTable<LogRow>(page, 'medicationLogs'));
  const medLogs = logs2.filter((l) => l.medicationId === med!.id);
  expect(medLogs.length).toBeGreaterThan(0);
  expect(medLogs.every((l) => l.status === 'taken')).toBe(true);
});

/* ────────────────── 4. 覆診：確認卡 → 確認後先寫入（C6 迴歸守衛：帶時間覆診 timeTbd 必為 false）────────────────── */

test('語音句3：「下星期三下午三點去鏡湖覆診」→ 確認卡未寫入；確認後先寫入', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  const before = fresh(await dbTable<ApptRow>(page, 'appointments')).length;

  const bubble = await askElder(page, '下星期三下午三點去鏡湖覆診');
  await expect(bubble).toContainText('啱唔啱');
  const card = page.getByTestId('voice-confirm-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('voice-confirm-summary')).toContainText('鏡湖');
  await expect(page.getByTestId('voice-confirm-summary')).toContainText('15:00');

  // 未確認 → 絕不寫庫
  expect(fresh(await dbTable<ApptRow>(page, 'appointments')).length).toBe(before);

  // 點「確認記錄」→ 寫入
  await page.getByTestId('voice-confirm-yes').click();
  await expect(bubble).toContainText('記低咗');
  const appts = fresh(await dbTable<ApptRow>(page, 'appointments'));
  expect(appts.length).toBe(before + 1);
  const appt = appts.find((a) => a.location === '鏡湖');
  expect(appt, '應寫入地點「鏡湖」嘅覆診').toBeTruthy();
  expect(appt!.timeTbd).toBeUndefined();
  // 本地時間 15:00
  const d = new Date(appt!.date);
  expect(d.getHours()).toBe(15);
  expect(d.getMinutes()).toBe(0);
});

/* ────────────────── 5. 搵家人 → 聯絡卡 ────────────────── */

test('語音句4：「搵我個仔」→ 聯絡卡（稱謂唔匹配時列全部 caregiver）', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  await askElder(page, '搵我個仔');

  const card = page.getByTestId('contact-card');
  await expect(card).toBeVisible();
  // seed 只有阿美（女兒）→ 稱謂「個仔」唔匹配，列全部
  await expect(card).toContainText('阿美');
  // 巨型撥號連結（tel:，僅點擊撥號）
  const call = page.locator('[data-testid^="contact-call-"]');
  await expect(call.first()).toBeVisible();
  await expect(call.first()).toHaveAttribute('href', /tel:/);
  // 「通知佢我唔舒服」掣
  await expect(page.locator('[data-testid^="contact-notify-"]').first()).toBeVisible();
});

/* ────────────────── 6. 離線本地引擎確定性 ────────────────── */

test('離線（provider=local）：核心語音句仍確定可用', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);
  // config 已強制無 DEEPSEEK_API_KEY → 本地引擎；呢度再斷言確定性回覆
  const bubble = await askElder(page, '我啱啱血壓 145/90');
  await expect(bubble).toContainText('記低咗');
  await expect(bubble).toContainText('145/90');
});

/* ────────────────── 7. 藥物模糊搜尋 ────────────────── */

test('藥物模糊：部分藥名「降壓」搵到降壓藥', async ({ page }) => {
  await gotoElder(page);
  await page.getByTestId('quick-med').click();
  const search = page.getByTestId('med-search-input');
  await expect(search).toBeVisible();
  await search.click();
  await search.fill('降壓');
  const options = page.locator('[data-testid^="med-search-option-"]');
  await expect(options.filter({ hasText: '降壓藥' }).first()).toBeVisible();
});

/* ────────────────── 8. 覆診表單（combobox + 時間未定）────────────────── */

test('覆診表單：鏡湖 combobox、科別、醫生、日期時間保存；時間未定顯示「時間未定」', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/elder/health');
  await expect(page.getByTestId('appointment-list')).toBeVisible({ timeout: 30_000 });

  // ── 第一筆：鏡湖（combobox 搜尋）＋ 科別 ＋ 醫生 ＋ 日期時間 ──
  await page.getByTestId('appt-add-open').click();
  const locInput = page.getByTestId('appt-location-input');
  await expect(locInput).toBeVisible();
  await locInput.fill('鏡湖');
  await page
    .locator('[data-testid^="appt-location-option-"]')
    .filter({ hasText: '鏡湖醫院' })
    .first()
    .click();
  await expect(locInput).toHaveValue('鏡湖醫院');

  await page.getByTestId('appt-specialty-心臟科').click();
  await page.getByTestId('appt-doctor').fill('陳醫生');
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
    tomorrow.getDate(),
  ).padStart(2, '0')}`;
  await page.getByTestId('appt-date').fill(dateStr);
  await page.getByTestId('appt-time').fill('14:30');
  await page.getByRole('button', { name: '記低覆診' }).click();

  const list = page.getByTestId('appointment-list');
  await expect(list).toContainText('鏡湖醫院');
  await expect(list).toContainText('心臟科 · 陳醫生');

  // ── 第二筆：時間未定 ──
  await page.getByTestId('appt-add-open').click();
  await page.getByTestId('appt-location-input').fill('山頂醫院');
  await page.getByTestId('appt-date').fill(dateStr);
  await page.getByTestId('appt-time-tbd').check();
  await page.getByRole('button', { name: '記低覆診' }).click();

  const tbdItem = list.locator('li').filter({ hasText: '山頂醫院' }).first();
  await expect(tbdItem).toContainText('時間未定');

  // DB 雙重驗證
  const appts = fresh(await dbTable<ApptRow>(page, 'appointments'));
  expect(appts.some((a) => a.location === '鏡湖醫院' && !a.timeTbd)).toBe(true);
  expect(appts.some((a) => a.location === '山頂醫院' && a.timeTbd === true)).toBe(true);
});

/* ────────────────── 9. 血壓不完整 → 追問唔寫入 ────────────────── */

test('血壓不完整「我要記血壓」→ 追問氣泡，不寫入', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoElder(page);

  const before = (await dbTable<VitalRow>(page, 'vitalRecords')).length;
  const bubble = await askElder(page, '我要記血壓');
  await expect(bubble).toContainText('上壓同下壓');
  expect((await dbTable<VitalRow>(page, 'vitalRecords')).length).toBe(before);
});

/* ────────────────── 10. 藥物多候選：候選卡 → 揀第一個 → 寫入 ────────────────── */

test('藥物多候選：候選卡出現；「都唔係」唔寫入；揀第一個候選 → MedicationLog 寫入', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoElder(page);

  // seed 兩隻含共同子串「護心素」嘅藥（子串唔喺藥名開頭——prefix 命中會令
  // 置信度升 high 而直寫；contains 先係低置信候選。命名避開 seed／其他用例
  // 藥物）。直接寫 IndexedDB（應用 list 實讀 DB）。dosage 留空：matchMedications
  // 對 dosage 都檢索，避免劑量線索帶來額外強 tier 命中。
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    const rows = ['甲型護心素', '乙型護心素'].map((name, i) => ({
      id: `e2e-med-hx-${i}`,
      elderId: 'seed-elder-01',
      name,
      dosage: '',
      schedule: '每朝 8 時',
      createdAt: now,
      updatedAt: now,
    }));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('silvercare-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('medications', 'readwrite');
        const store = tx.objectStore('medications');
        for (const r of rows) store.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  const meds = fresh(await dbTable<MedRow>(page, 'medications'));
  const medA = meds.find((m) => m.name === '甲型護心素');
  const medB = meds.find((m) => m.name === '乙型護心素');
  expect(medA).toBeTruthy();
  expect(medB).toBeTruthy();
  // 只比較本用例新增嘅 log（DB 跨用例／跨輪持久化）
  const logsBefore = fresh(await dbTable<LogRow>(page, 'medicationLogs'));
  const newLogs = async (): Promise<LogRow[]> =>
    (fresh(await dbTable<LogRow>(page, 'medicationLogs'))).filter(
      (l) => !logsBefore.some((b) => b.id === l.id),
    );

  // 模糊藥名 → 兩隻都「包含」查詢詞（contains 弱級）→ 低置信多候選卡，唔寫入
  const bubble = await askElder(page, '我食咗一粒護心素');
  await expect(bubble).toContainText('邊一種');
  const card = page.getByTestId('med-candidate-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('med-candidate-0')).toContainText('護心素');
  await expect(page.getByTestId('med-candidate-1')).toContainText('護心素');

  // 「都唔係」→ 唔寫入（兩隻藥冇新增任何 MedicationLog）
  await page.getByTestId('med-candidate-none').click();
  await expect(page.getByTestId('answer-bubble')).toContainText('唔記食藥');
  expect(
    (await newLogs()).filter((l) => l.medicationId === medA!.id || l.medicationId === medB!.id),
  ).toHaveLength(0);

  // 再講一次 → 候選卡再出現 → 點第一個候選 → MedicationLog 寫入 taken
  const bubble2 = await askElder(page, '我食咗一粒護心素');
  await expect(bubble2).toContainText('邊一種');
  await expect(page.getByTestId('med-candidate-card')).toBeVisible();
  const chosenText = await page.getByTestId('med-candidate-0').innerText();
  await page.getByTestId('med-candidate-0').click();
  await expect(page.getByTestId('answer-bubble')).toContainText('記低咗');

  const chosen = chosenText.includes('甲型護心素') ? medA! : medB!;
  const written = (await newLogs()).filter((l) => l.medicationId === chosen.id);
  expect(written.length).toBeGreaterThan(0);
  expect(written.some((l) => l.status === 'taken')).toBe(true);
});

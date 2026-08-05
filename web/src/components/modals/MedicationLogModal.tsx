/**
 * 「記錄食藥」彈窗（長者友善重做版，Task #13）：
 *
 * 藥物（SearchableCombobox 搜尋／零匹配就地新藥）→ 每次份量
 * （數字＋單位 → formatDose 合成 dosage）→ 幾時食（chips → scheduledAt）
 * → 狀態大按鈕（已服／延遲／漏服）。
 *
 * - 新藥流程：createMedication → recordMedicationStatus（全部 DB 實算）。
 * - toast 文案與 data-testid（med-taken/med-late/med-missed）保持不變。
 */
import { useEffect, useMemo, useState } from 'react';

import Modal from '../Modal';
import SearchableCombobox from '../SearchableCombobox';
import { getProvider } from '../../data/DataProvider';
import { tableNameOf } from '../../types/entities';
import type { Medication, MedicationLog } from '../../types/entities';
import { useAsyncData } from '../../lib/hooks';
import { createMedication, recordMedicationStatus } from '../../lib/manualEntry';
import { matchMedications } from '../../lib/medicationSearch';
import { DOSE_UNITS, formatDose, parseDosage } from '../../lib/doseFormat';
import { MED_STATUS_LABELS } from '../../lib/format';

/* ---------------- 時間 chips ---------------- */

type TimeKey =
  | 'now'
  | 'pre-breakfast'
  | 'post-breakfast'
  | 'pre-lunch'
  | 'post-lunch'
  | 'pre-dinner'
  | 'post-dinner'
  | 'bedtime'
  | 'custom';

/** 固定時段 chips（「而家」與「自訂時間」另行處理）。 */
const TIME_CHIPS: Array<{ key: TimeKey; label: string; time?: string }> = [
  { key: 'now', label: '而家' },
  { key: 'pre-breakfast', label: '早餐前', time: '07:30' },
  { key: 'post-breakfast', label: '早餐後', time: '08:30' },
  { key: 'pre-lunch', label: '午餐前', time: '11:30' },
  { key: 'post-lunch', label: '午餐後', time: '12:30' },
  { key: 'pre-dinner', label: '晚餐前', time: '17:30' },
  { key: 'post-dinner', label: '晚餐後', time: '18:30' },
  { key: 'bedtime', label: '睡前', time: '21:30' },
  { key: 'custom', label: '自訂時間' },
];

/** 今日指定 HH:mm（本地時間）的 ISO；缺省或無法解析時用現在。 */
function isoTodayAt(hhmm?: string): string {
  const d = new Date();
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) d.setHours(h, m, 0, 0);
  }
  return d.toISOString();
}

/* ---------------- 元件 ---------------- */

interface MedicationLogModalProps {
  elderId: string;
  dbVersion: number;
  onClose: () => void;
  onDone: (msg: string) => void;
  /**
   * 受控預填（T16）：語音門控提議開表單時帶入藥物搜尋字。
   * 有值時跳過「預選第一隻藥」，以搜尋字開局。
   */
  initialQuery?: string;
}

export default function MedicationLogModal({
  elderId,
  dbVersion,
  onClose,
  onDone,
  initialQuery,
}: MedicationLogModalProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* 藥物搜尋 */
  const [query, setQuery] = useState(initialQuery ?? '');
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newMedName, setNewMedName] = useState('');

  /* 每次份量 */
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [doseHint, setDoseHint] = useState('');

  /* 幾時食 */
  const [timeKey, setTimeKey] = useState<TimeKey>('now');
  const [customTime, setCustomTime] = useState('');

  const { data: meds } = useAsyncData(async () => {
    if (!elderId) return [];
    return getProvider().list<Medication>(tableNameOf('Medication'), { elderId });
  }, [dbVersion, elderId]);

  /** 以既有藥物的 dosage 預填份量（parseDosage 失敗則顯示原文提示）。 */
  const prefillDose = (m: Medication): void => {
    if (m.doseAmount !== undefined || m.doseUnit) {
      setDoseAmount(m.doseAmount !== undefined ? String(m.doseAmount) : '');
      const unit = m.doseUnit ?? '';
      if ((DOSE_UNITS as readonly string[]).includes(unit)) {
        setDoseUnit(unit);
        setCustomUnit('');
      } else {
        setDoseUnit(unit ? '其他' : '');
        setCustomUnit(unit);
      }
      setDoseHint('');
      return;
    }
    const parsed = parseDosage(m.dosage);
    if (parsed) {
      setDoseAmount(parsed.amount !== undefined ? String(parsed.amount) : '');
      setDoseUnit(parsed.unit ?? '');
      setCustomUnit('');
      setDoseHint('');
    } else {
      setDoseAmount('');
      setDoseUnit('');
      setCustomUnit('');
      setDoseHint(m.dosage ? `原本劑量：${m.dosage}` : '');
    }
  };

  /* 首次載入後預選第一隻藥（有預填搜尋字時跳過，以搜尋字開局） */
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    if (primed || meds === null) return;
    setPrimed(true);
    if (initialQuery) return; // T16 預填：唔預選第一隻藥
    const first = meds[0];
    if (first) {
      setSelectedId(first.id);
      setQuery(first.name);
      prefillDose(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meds, primed]);

  /* 選項排序：有輸入時以 matchMedications 命中優先（過濾由 combobox 處理） */
  const { options, confidence } = useMemo(() => {
    const list = meds ?? [];
    const q = query.trim();
    if (!q) {
      return {
        options: list.map((m) => ({ value: m.id, label: m.name, sublabel: m.dosage || m.schedule })),
        confidence: 'none' as const,
      };
    }
    const { candidates, confidence: conf } = matchMedications(q, list);
    const matchedIds = new Set(candidates.map((c) => c.id));
    const ordered = [...candidates, ...list.filter((m) => !matchedIds.has(m.id))];
    return {
      options: ordered.map((m) => ({
        value: m.id,
        label: m.name,
        sublabel: m.dosage || m.schedule,
      })),
      confidence: conf,
    };
  }, [meds, query]);

  const selected = (meds ?? []).find((m) => m.id === selectedId);
  const dosePreview = formatDose(doseAmount, doseUnit, customUnit);
  const resolvedUnit = doseUnit === '其他' ? customUnit.trim() : doseUnit.trim();

  const resolveScheduledAt = (): string => {
    if (timeKey === 'now') return new Date().toISOString();
    if (timeKey === 'custom') return isoTodayAt(customTime || undefined);
    const chip = TIME_CHIPS.find((c) => c.key === timeKey);
    return isoTodayAt(chip?.time);
  };

  const timeLabelOf = (key: TimeKey): string =>
    TIME_CHIPS.find((c) => c.key === key)?.label ?? '';

  const submit = async (status: MedicationLog['status']): Promise<void> => {
    if (busy || status === 'pending') return;
    setErr('');
    setBusy(true);
    try {
      let medId = selectedId;
      if (creating) {
        const name = newMedName.trim() || query.trim();
        if (!name) {
          setErr('請輸入藥名。');
          setBusy(false);
          return;
        }
        const amountNum = Number(doseAmount);
        const created = await createMedication(getProvider(), elderId, {
          name,
          dosage: formatDose(doseAmount, doseUnit, customUnit),
          schedule: timeLabelOf(timeKey),
          ...(doseAmount.trim() !== '' && !Number.isNaN(amountNum)
            ? { doseAmount: amountNum }
            : {}),
          ...(resolvedUnit ? { doseUnit: resolvedUnit } : {}),
        });
        medId = created.id;
      }
      if (!medId) {
        setErr('請先揀藥，或者新增一隻新藥。');
        setBusy(false);
        return;
      }
      await recordMedicationStatus(elderId, medId, status, resolveScheduledAt());
      onDone(`已記低：${MED_STATUS_LABELS[status]} ✓`);
    } catch {
      setErr('出咗啲問題，請再試一次。');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'min-h-12 w-full rounded-xl border-2 border-[var(--sc-line)] bg-white px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]';

  return (
    <Modal title="記錄食藥" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {/* ── 藥物 ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xl font-bold">邊種藥？</span>
          {creating ? (
            <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-[var(--sc-line)] bg-[var(--sc-idle-soft)]/40 p-4">
              <label className="flex flex-col gap-1 text-xl font-bold">
                新藥名
                <input
                  data-testid="med-new-name-input"
                  type="text"
                  value={newMedName}
                  onChange={(e) => setNewMedName(e.target.value)}
                  className={inputCls}
                  aria-label="新藥名"
                />
              </label>
              <button
                type="button"
                data-testid="med-create-back"
                className="btn-elder btn-ghost !min-h-12 self-start !px-4 text-lg"
                onClick={() => {
                  setCreating(false);
                  setNewMedName('');
                }}
              >
                ← 返回揀藥
              </button>
            </div>
          ) : (
            <>
              <SearchableCombobox
                options={options}
                value={query}
                onChange={(text) => {
                  setQuery(text);
                  if (!selected || text !== selected.name) setSelectedId('');
                }}
                onSelect={(value) => {
                  const m = (meds ?? []).find((x) => x.id === value);
                  if (!m) return;
                  setSelectedId(m.id);
                  setQuery(m.name);
                  prefillDose(m);
                }}
                placeholder="輸入藥名搜尋……"
                testIdPrefix="med-search"
                onCreate={(text) => {
                  setCreating(true);
                  setNewMedName(text);
                  setSelectedId('');
                }}
              />
              {confidence === 'low' && (
                <p className="text-lg text-[var(--sc-thinking)]">請核對藥名無誤再記錄。</p>
              )}
              {selected && selected.schedule && (
                <p className="text-xl text-[var(--sc-ink-soft)]">時間：{selected.schedule}</p>
              )}
            </>
          )}
        </div>

        {/* ── 每次份量 ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xl font-bold">每次份量</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="med-dose-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={doseAmount}
              onChange={(e) => setDoseAmount(e.target.value)}
              placeholder="0"
              aria-label="每次份量數值"
              className={`${inputCls} max-w-28 flex-none`}
            />
            <select
              data-testid="med-dose-unit"
              value={doseUnit}
              onChange={(e) => setDoseUnit(e.target.value)}
              aria-label="劑量單位"
              className={`${inputCls} flex-1 basis-32 bg-white`}
            >
              <option value="">（揀單位）</option>
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {doseUnit === '其他' && (
              <input
                data-testid="med-dose-custom-unit"
                type="text"
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                placeholder="自訂單位"
                aria-label="自訂單位"
                className={`${inputCls} flex-1 basis-32`}
              />
            )}
          </div>
          {dosePreview && (
            <p className="text-xl text-[var(--sc-ink-soft)]">
              每次：<span className="font-bold text-[var(--sc-ink)]">{dosePreview}</span>
            </p>
          )}
          {doseHint && <p className="text-lg text-[var(--sc-muted)]">{doseHint}</p>}
        </div>

        {/* ── 幾時食？ ── */}
        <div className="flex flex-col gap-2">
          <span className="text-xl font-bold">幾時食？</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="服藥時間">
            {TIME_CHIPS.map((chip) => (
              <button
                key={chip.key}
                type="button"
                data-testid={`med-time-${chip.key}`}
                aria-pressed={timeKey === chip.key}
                onClick={() => setTimeKey(chip.key)}
                className={`min-h-12 rounded-full border-2 px-4 text-xl font-bold transition-colors ${
                  timeKey === chip.key
                    ? 'border-[var(--sc-idle)] bg-[var(--sc-idle)] text-white'
                    : 'border-[var(--sc-line)] bg-white text-[var(--sc-ink)]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {timeKey === 'custom' && (
            <input
              data-testid="med-time-custom-input"
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              aria-label="自訂時間"
              className={`${inputCls} max-w-44`}
            />
          )}
        </div>

        {/* ── 狀態 ── */}
        {err && (
          <p role="alert" className="text-xl text-[var(--sc-urgent)]">
            {err}
          </p>
        )}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            data-testid="med-taken"
            className="btn-elder btn-ok w-full !min-h-16 text-2xl"
            onClick={() => void submit('taken')}
            disabled={busy}
          >
            已服 ✓
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="med-late"
              className="btn-elder btn-primary !min-h-14"
              onClick={() => void submit('late')}
              disabled={busy}
            >
              延遲
            </button>
            <button
              type="button"
              data-testid="med-missed"
              className="btn-elder btn-urgent !min-h-14"
              onClick={() => void submit('missed')}
              disabled={busy}
            >
              漏服
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

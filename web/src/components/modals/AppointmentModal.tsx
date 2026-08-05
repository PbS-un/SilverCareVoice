/**
 * 「新增覆診」表單彈窗（路由 '/elder/health' 使用）。
 *
 * 欄位：
 * - 醫院／診所：SearchableCombobox（歷史 Appointment.location 去重 +
 *   ResourceDirectory + KnowledgeBase service 類條目），自由輸入即可採用。
 * - 覆診日期 + 時間分開輸入；「時間未定」toggle → timeTbd: true，
 *   存儲 `new Date(\`${date}T00:00:00\`).toISOString()`；有時間則 `T${time}:00`。
 * - 睇邊科（specialty，「其他」可自填）、醫生（doctor，選填）、備註（兩行）。
 * - quick chips 只預填、不自動提交。
 */
import { useEffect, useMemo, useState } from 'react';

import Modal from '../Modal';
import SearchableCombobox, { type ComboboxOption } from '../SearchableCombobox';
import { getProvider } from '../../data/DataProvider';
import { KNOWLEDGE_BASE } from '../../data/knowledgeBase';
import { tableNameOf } from '../../types/entities';
import type { Appointment, ResourceDirectory } from '../../types/entities';
import { useI18n } from '../../i18n';

/** 專科選項（「其他」觸发自填欄位）。 */
const SPECIALTIES = [
  '普通科',
  '心臟科',
  '高血壓',
  '糖尿病',
  '內科',
  '外科',
  '骨科',
  '眼科',
  '耳鼻喉科',
  '復康',
  '中醫',
  '牙科',
  '其他',
];

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}`;
}

/** 本地日期 → 'YYYY-MM-DD'（date input 值格式）。 */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 受控預填欄位（T16：語音門控「改一改」／openForm 帶入）。 */
export interface AppointmentModalInitial {
  location?: string;
  /** YYYY-MM-DD（date input 值格式）。 */
  date?: string;
  /** HH:MM（time input 值格式）。 */
  time?: string;
  specialty?: string;
  doctor?: string;
  note?: string;
  timeTbd?: boolean;
}

export interface AppointmentModalProps {
  elderId: string;
  /** 既有覆診（供地點候選去重）。 */
  appointments: Appointment[];
  onClose: () => void;
  /** 成功儲存後回調（父層顯示 toast）。 */
  onDone: () => void;
  /** 受控預填（選填）。 */
  initial?: AppointmentModalInitial;
}

export default function AppointmentModal({
  elderId,
  appointments,
  onClose,
  onDone,
  initial,
}: AppointmentModalProps) {
  const { t } = useI18n();
  const [location, setLocation] = useState(initial?.location ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [timeTbd, setTimeTbd] = useState(initial?.timeTbd ?? false);
  // specialty 預填：喺選項列表內直接揀；唔喺就放入「其他」自填欄
  const inList = initial?.specialty !== undefined && SPECIALTIES.includes(initial.specialty);
  const [specialty, setSpecialty] = useState(inList ? (initial?.specialty ?? '') : initial?.specialty ? '其他' : '');
  const [otherSpecialty, setOtherSpecialty] = useState(inList || !initial?.specialty ? '' : initial.specialty);
  const [doctor, setDoctor] = useState(initial?.doctor ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const resources = useResourceDirectory();

  // 地點候選：歷史地點 → 資源目錄 → 知識庫 service 條目（同名去重）
  const locationOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const opts: ComboboxOption[] = [];
    const push = (label: string, sublabel?: string): void => {
      const key = label.trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      opts.push(sublabel ? { value: key, label: key, sublabel } : { value: key, label: key });
    };
    for (const a of appointments) push(a.location, t('appt.visited'));
    for (const r of resources) push(r.name, `${r.category} · ${r.address}`);
    for (const k of KNOWLEDGE_BASE) {
      if (k.category === 'service') push(k.title, k.location ?? t('appt.community'));
    }
    return opts;
  }, [appointments, resources]);

  const applyChip = (kind: 'week' | 'month' | 'hospital' | 'family'): void => {
    if (kind === 'week') {
      setDate(toDateInputValue(new Date(Date.now() + 7 * 86_400_000)));
    } else if (kind === 'month') {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setDate(toDateInputValue(d));
    } else if (kind === 'hospital') {
      setLocation('醫院覆診');
    } else {
      setLocation('家庭醫生');
    }
  };

  const finalSpecialty = (): string => {
    if (specialty === '其他') return otherSpecialty.trim();
    return specialty;
  };

  const submit = async (): Promise<void> => {
    if (!date || !location.trim()) {
      setErr(t('appt.errorDateLocation'));
      return;
    }
    if (!timeTbd && !time) {
      setErr(t('appt.errorTime'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const t = new Date().toISOString();
      const appt: Appointment = {
        id: newId(),
        elderId,
        date: timeTbd
          ? new Date(`${date}T00:00:00`).toISOString()
          : new Date(`${date}T${time}:00`).toISOString(),
        location: location.trim(),
        ...(timeTbd ? { timeTbd: true } : {}),
        ...(finalSpecialty() ? { specialty: finalSpecialty() } : {}),
        ...(doctor.trim() ? { doctor: doctor.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        createdAt: t,
        updatedAt: t,
      };
      await getProvider().put<Appointment>(tableNameOf('Appointment'), appt);
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('appt.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* quick chips：只預填，不自動提交 */}
        <div className="flex flex-wrap gap-2" aria-label={t('appt.quickAria')}>
          <button
            type="button"
            data-testid="appt-chip-week"
            onClick={() => applyChip('week')}
            className="btn-elder btn-ghost !min-h-11 !px-3 text-lg"
          >
            {t('appt.chipWeek')}
          </button>
          <button
            type="button"
            data-testid="appt-chip-month"
            onClick={() => applyChip('month')}
            className="btn-elder btn-ghost !min-h-11 !px-3 text-lg"
          >
            {t('appt.chipMonth')}
          </button>
          <button
            type="button"
            data-testid="appt-chip-hospital"
            onClick={() => applyChip('hospital')}
            className="btn-elder btn-ghost !min-h-11 !px-3 text-lg"
          >
            {t('appt.chipHospital')}
          </button>
          <button
            type="button"
            data-testid="appt-chip-family"
            onClick={() => applyChip('family')}
            className="btn-elder btn-ghost !min-h-11 !px-3 text-lg"
          >
            {t('appt.chipFamily')}
          </button>
        </div>

        {/* 醫院／診所 */}
        <div className="flex flex-col gap-1">
          <span className="text-xl font-bold">{t('appt.location')}</span>
          <SearchableCombobox
            options={locationOptions}
            value={location}
            onChange={setLocation}
            onSelect={setLocation}
            placeholder={t('appt.locationPlaceholder')}
            testIdPrefix="appt-location"
            onCreate={(text) => setLocation(text)}
            createLabel={(text) => t('appt.useText', { text })}
          />
        </div>

        {/* 日期 + 時間 */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xl font-bold">
            {t('appt.date')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t('appt.date')}
              data-testid="appt-date"
              className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-3 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xl font-bold">
            {t('appt.time')}
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label={t('appt.time')}
              disabled={timeTbd}
              data-testid="appt-time"
              className={`min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-3 text-elder-body outline-none focus:border-[var(--sc-idle)] ${
                timeTbd ? 'opacity-40' : ''
              }`}
            />
          </label>
        </div>
        <label className="flex min-h-12 items-center gap-3 text-xl font-bold">
          <input
            type="checkbox"
            checked={timeTbd}
            onChange={(e) => setTimeTbd(e.target.checked)}
            data-testid="appt-time-tbd"
            className="h-7 w-7 accent-[var(--sc-idle-deep)]"
          />
          {t('appt.timeTbd')}
        </label>

        {/* 睇邊科 */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xl font-bold">{t('appt.specialty')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {SPECIALTIES.map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`appt-specialty-${s}`}
                aria-pressed={specialty === s}
                onClick={() => setSpecialty(specialty === s ? '' : s)}
                className={`btn-elder !min-h-12 !px-1 text-lg ${
                  specialty === s ? 'btn-primary' : 'btn-ghost'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {specialty === '其他' && (
            <input
              type="text"
              value={otherSpecialty}
              onChange={(e) => setOtherSpecialty(e.target.value)}
              placeholder={t('appt.specialtyOtherPlaceholder')}
              aria-label={t('appt.specialtyOtherPlaceholder')}
              data-testid="appt-specialty-other-input"
              className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            />
          )}
        </fieldset>

        {/* 醫生 */}
        <label className="flex flex-col gap-1 text-xl font-bold">
          {t('appt.doctor')}
          <input
            type="text"
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            placeholder={t('appt.doctorPlaceholder')}
            aria-label={t('appt.doctor')}
            data-testid="appt-doctor"
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
          />
        </label>

        {/* 備註 */}
        <label className="flex flex-col gap-1 text-xl font-bold">
          {t('appt.note')}
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('appt.notePlaceholder')}
            aria-label={t('appt.note')}
            data-testid="appt-note"
            className="rounded-xl border-2 border-[var(--sc-line)] px-4 py-3 text-elder-body outline-none focus:border-[var(--sc-idle)]"
          />
        </label>

        {err && (
          <p role="alert" className="text-xl text-[var(--sc-urgent)]">
            {err}
          </p>
        )}
        <button type="submit" className="btn-elder btn-primary w-full" disabled={busy}>
          {busy ? t('appt.saving') : t('appt.save')}
        </button>
      </form>
    </Modal>
  );
}

/** 讀 ResourceDirectory（失敗回傳空陣，唔阻表單）。 */
function useResourceDirectory(): ResourceDirectory[] {
  const [data, setData] = useState<ResourceDirectory[]>([]);
  useEffect(() => {
    let alive = true;
    void getProvider()
      .list<ResourceDirectory>(tableNameOf('ResourceDirectory'))
      .then((rows) => {
        if (alive) setData(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

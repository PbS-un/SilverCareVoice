/**
 * 老人首頁（路由 '/elder'）：
 * 問候 → 大麥克風（4 狀態色）→ 文字輸入 → 快捷鍵（量血壓／記錄食藥／搵家人）
 * → 回答氣泡（TTS／再講多啲／provider 標記／免責）→ 今日狀態卡 → 歷史對話。
 * 緊急模式（riskLevel urgent）：紅色全屏提醒 + 通知家人 + 緊急求助。
 *
 * 所有數據 DB 實算、subscribe 自動刷新；嚴禁寫死陣列。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { ask, HEALTH_DISCLAIMER, type AssistantResponse } from '../core/assistant/AssistantService';
import { getProvider } from '../data/DataProvider';
import { tableNameOf } from '../types/entities';
import type {
  Alert,
  Conversation,
  HealthEvent,
  Medication,
  MedicationLog,
} from '../types/entities';
import { isSpeechSupported, startListening, stopListening } from '../services/speech/asr';
import { speak, stopSpeaking } from '../services/speech/tts';
import {
  notifyFamily,
  recordBloodPressure,
  recordMedicationStatus,
} from '../lib/manualEntry';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { greetingByHour, fmtTime, isToday, MED_STATUS_LABELS } from '../lib/format';
import BottomNav, { ELDER_NAV_ITEMS } from '../components/BottomNav';
import Modal from '../components/Modal';

type MicState = 'idle' | 'listening' | 'thinking' | 'done';

const MIC_STYLE: Record<MicState, string> = {
  idle: 'bg-[var(--sc-idle)]',
  listening: 'bg-[var(--sc-listening)]',
  thinking: 'bg-[var(--sc-thinking)]',
  done: 'bg-[var(--sc-ok)]',
};

const MIC_LABEL: Record<MicState, string> = {
  idle: '按一下開始說話',
  listening: '聽緊你講嘢……',
  thinking: '諗緊……',
  done: '答咗你啦',
};

export default function ElderHome() {
  const dbVersion = useDbVersion();
  const ctx = useElderContext(dbVersion);
  const elderId = ctx?.elderId ?? '';

  const speechOk = useMemo(() => isSpeechSupported(), []);
  const [micState, setMicState] = useState<MicState>('idle');
  const [interim, setInterim] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [modal, setModal] = useState<'bp' | 'med' | 'family' | null>(null);
  const [toast, setToast] = useState('');
  const micStateRef = useRef<MicState>('idle');
  micStateRef.current = micState;

  /* ---------------- 資料載入（subscribe 自動刷新） ---------------- */

  const { data: conversations } = useAsyncData(async () => {
    if (!elderId) return [];
    const rows = await getProvider().list<Conversation>(tableNameOf('Conversation'), { elderId });
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [dbVersion, elderId]);

  const { data: todayStatus } = useAsyncData(async () => {
    if (!elderId) return { events: [] as HealthEvent[], alerts: [] as Alert[] };
    const provider = getProvider();
    const [events, alerts] = await Promise.all([
      provider.list<HealthEvent>(tableNameOf('HealthEvent'), { elderId }),
      provider.list<Alert>(tableNameOf('Alert'), { elderId }),
    ]);
    return {
      events: events.filter((e) => e.severity !== 'normal' && isToday(e.createdAt)),
      alerts: alerts.filter((a) => isToday(a.createdAt)),
    };
  }, [dbVersion, elderId]);

  /* ---------------- 送出訊息（語音／文字同一路徑） ---------------- */

  const sendMessage = async (raw: string, source: 'voice' | 'text'): Promise<void> => {
    const msg = raw.trim();
    if (!msg || !elderId || sending) return;
    setSending(true);
    setErrorMsg('');
    setMicState('thinking');
    setShowDetail(false);
    try {
      const res = await ask(elderId, msg, { source, userName: ctx?.elderName });
      setResponse(res);
      setMicState('done');
      if (res.riskLevel === 'urgent') setEmergencyOpen(true);
    } catch {
      setErrorMsg('出咗啲問題，請再試一次。');
      setMicState('idle');
    } finally {
      setSending(false);
    }
  };

  /* ---------------- 麥克風 ---------------- */

  const toggleMic = (): void => {
    if (!speechOk) return;
    stopSpeaking();
    setSpeaking(false);
    if (micState === 'listening') {
      stopListening();
      setMicState('idle');
      setInterim('');
      return;
    }
    setInterim('');
    setMicState('listening');
    startListening({
      onInterim: (t) => setInterim(t),
      onResult: (t) => {
        setInterim('');
        setText(t);
        void sendMessage(t, 'voice');
      },
      onError: (err) => {
        setErrorMsg(err.message);
        setInterim('');
        setMicState('idle');
      },
      onEnd: () => {
        if (micStateRef.current === 'listening') setMicState('idle');
      },
    });
  };

  useEffect(() => () => stopListening(), []);

  /* ---------------- TTS ---------------- */

  const toggleSpeak = (): void => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (!response) return;
    const ok = speak(response.answer, {
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
    setSpeaking(ok);
  };

  /* ---------------- 快捷鍵動作 ---------------- */

  const onFamilyNotified = (msg: string): void => setToast(msg);

  const attentionCount = todayStatus?.events.length ?? 0;
  const familyKnows = (todayStatus?.alerts ?? []).some((a) => a.status !== 'open');

  if (!ctx) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
          載入緊……
        </p>
      </main>
    );
  }

  return (
    <main className="bg-paper-grain mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-28 pt-6">
      {/* 問候 */}
      <header className="mb-5">
        <h1 className="font-serif-display text-elder-display text-ink">
          {ctx.elderName}，{greetingByHour()}！
        </h1>
        <p className="mt-1 text-elder-body text-[var(--sc-ink-soft)]">今日有冇唔舒服？</p>
      </header>

      {/* 麥克風（ASR 不支援時自動隱藏，文字輸入常駐） */}
      {speechOk && (
        <section className="mb-6 flex flex-col items-center gap-3" aria-label="語音輸入">
          <button
            type="button"
            data-testid="mic-button"
            aria-label={MIC_LABEL[micState]}
            onClick={toggleMic}
            className={`flex h-[8.5rem] w-[8.5rem] items-center justify-center rounded-full text-white shadow-xl transition-transform focus-visible:outline-offset-4 active:scale-95 ${MIC_STYLE[micState]} ${
              micState === 'listening' || micState === 'thinking' ? 'animate-breathe' : ''
            }`}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-16 w-16" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11Z" />
            </svg>
          </button>
          <p className="text-xl font-bold" aria-live="polite">
            {interim || MIC_LABEL[micState]}
          </p>
        </section>
      )}

      {/* 文字輸入（常駐，≥24px） */}
      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(text, 'text');
          setText('');
        }}
      >
        <input
          data-testid="text-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="打字都得，例如：我今日有啲頭暈"
          aria-label="文字輸入"
          className="min-h-14 w-full rounded-2xl border-2 border-[var(--sc-line)] bg-white px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
        />
        <button
          type="submit"
          data-testid="send-button"
          aria-label="發送"
          className="btn-elder btn-primary shrink-0"
          disabled={sending || text.trim() === ''}
        >
          {sending ? '……' : '發送'}
        </button>
      </form>

      {/* 錯誤提示 */}
      {errorMsg && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-xl text-[var(--sc-urgent)]">
          {errorMsg}
        </p>
      )}

      {/* 快捷鍵 */}
      <section aria-label="快捷功能" className="mb-6 grid grid-cols-3 gap-3">
        <button
          type="button"
          data-testid="quick-bp"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('bp')}
        >
          <span aria-hidden className="text-3xl">🩺</span>
          量血壓
        </button>
        <button
          type="button"
          data-testid="quick-med"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('med')}
        >
          <span aria-hidden className="text-3xl">💊</span>
          記錄食藥
        </button>
        <button
          type="button"
          data-testid="quick-family"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('family')}
        >
          <span aria-hidden className="text-3xl">📞</span>
          搵家人
        </button>
      </section>

      {/* 回答氣泡 */}
      {response && (
        <section
          data-testid="answer-bubble"
          className="card-elder mb-6 border-l-8 border-l-[var(--sc-idle)]"
          aria-live="polite"
        >
          <p className="text-elder-body-lg font-medium leading-relaxed">{response.answer}</p>
          {showDetail && response.detailedAnswer && (
            <p className="mt-3 whitespace-pre-line rounded-xl bg-[var(--sc-idle-soft)] p-4 text-elder-body leading-relaxed">
              {response.detailedAnswer}
            </p>
          )}
          {response.sources && response.sources.length > 0 && (
            <p className="mt-3 text-base text-[var(--sc-ink-soft)]">
              資料來源：{response.sources.join('、')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="speak-button"
              className="btn-elder btn-primary !min-h-12 !px-4 text-xl"
              onClick={toggleSpeak}
            >
              {speaking ? '⏹ 停' : '🔊 播放'}
            </button>
            {response.detailedAnswer && (
              <button
                type="button"
                data-testid="more-button"
                className="btn-elder btn-ghost !min-h-12 !px-4 text-xl"
                onClick={() => setShowDetail((v) => !v)}
              >
                {showDetail ? '收埋' : '再講多啲'}
              </button>
            )}
            <span className="ml-auto rounded-full border border-[var(--sc-line)] px-3 py-1 text-base text-[var(--sc-ink-soft)]">
              {response.provider === 'deepseek' ? 'DeepSeek' : response.provider === 'safety' ? '安全檢查' : '離線模式'}
            </span>
          </div>
          <p className="mt-3 text-base text-[var(--sc-muted)]">{HEALTH_DISCLAIMER}</p>
        </section>
      )}

      {/* 提示 toast */}
      {toast && (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xl font-bold text-[var(--sc-ok)]">
          {toast}
        </p>
      )}

      {/* 今日狀態卡（實算） */}
      <section data-testid="today-status" className="card-elder mb-6" aria-label="今日狀態">
        <h2 className="mb-2 text-xl font-bold text-[var(--sc-ink-soft)]">今日狀態</h2>
        {attentionCount === 0 ? (
          <p className="text-elder-body font-bold text-[var(--sc-ok)]">大致正常 ✓</p>
        ) : (
          <p className="text-elder-body font-bold text-[var(--sc-thinking)]">
            有 {attentionCount} 件事要留意
          </p>
        )}
        {familyKnows && <p className="mt-1 text-xl text-[var(--sc-ink-soft)]">家人已經知道 ✓</p>}
      </section>

      {/* 歷史對話 */}
      <section aria-label="歷史對話" className="mb-4">
        <h2 className="mb-3 text-elder-title font-serif-display">之前傾過</h2>
        <div
          data-testid="conversation-history"
          className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--sc-line)] bg-white/60 p-4"
        >
          {(conversations ?? [])
            .filter((c) => c.role !== 'system')
            .slice(-30)
            .map((c) => (
              <div
                key={c.id}
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-xl leading-relaxed ${
                  c.role === 'elder'
                    ? 'self-end bg-[var(--sc-idle)] text-white'
                    : 'self-start bg-[var(--sc-idle-soft)] text-ink'
                }`}
              >
                <span className="mb-0.5 block text-sm opacity-75">
                  {c.role === 'elder' ? '你' : '助手'} · {fmtTime(c.createdAt)}
                </span>
                {c.message}
              </div>
            ))}
          {(conversations ?? []).filter((c) => c.role !== 'system').length === 0 && (
            <p className="text-xl text-[var(--sc-muted)]">仲未傾過嘢，由上面開始啦。</p>
          )}
        </div>
      </section>

      {/* 彈窗：量血壓 */}
      {modal === 'bp' && (
        <BloodPressureModal
          elderId={elderId}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            onFamilyNotified(msg);
          }}
        />
      )}

      {/* 彈窗：記錄食藥 */}
      {modal === 'med' && (
        <MedicationModal
          elderId={elderId}
          dbVersion={dbVersion}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            onFamilyNotified(msg);
          }}
        />
      )}

      {/* 彈窗：搵家人 */}
      {modal === 'family' && (
        <FamilyModal
          elderId={elderId}
          caregiverName={ctx.caregiver?.name ?? '家人'}
          caregiverPhone={ctx.caregiver?.phone ?? ''}
          caregiverRelation={ctx.caregiver?.relation ?? ''}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            onFamilyNotified(msg);
          }}
        />
      )}

      {/* 緊急模式 */}
      {emergencyOpen && response && (
        <EmergencyOverlay
          response={response}
          elderId={elderId}
          onClose={() => setEmergencyOpen(false)}
          onNotified={() => {
            setEmergencyOpen(false);
            onFamilyNotified('已經通知家人 ✓');
          }}
        />
      )}

      <BottomNav items={ELDER_NAV_ITEMS} />
    </main>
  );
}

/* ==================== 彈窗元件 ==================== */

function BloodPressureModal({
  elderId,
  onClose,
  onDone,
}: {
  elderId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (): Promise<void> => {
    const s = Number(sys);
    const d = Number(dia);
    if (!s || !d || s < 50 || s > 260 || d < 30 || d > 160) {
      setErr('請輸入合理數字（收縮壓 50–260、舒張壓 30–160）');
      return;
    }
    setBusy(true);
    try {
      const { events } = await recordBloodPressure(elderId, s, d);
      const worst = events.some((e) => e.severity === 'urgent')
        ? '已記低。血壓偏高，已經通知家人！'
        : events.length > 0
          ? '已記低。有啲數值要留意，家人會收到提醒。'
          : '已記低你嘅血壓 ✓';
      onDone(worst);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="量血壓" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xl font-bold">
          收縮壓（上壓）
          <input
            data-testid="bp-systolic-input"
            type="number"
            inputMode="numeric"
            value={sys}
            onChange={(e) => setSys(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            aria-label="收縮壓"
          />
        </label>
        <label className="flex flex-col gap-1 text-xl font-bold">
          舒張壓（下壓）
          <input
            data-testid="bp-diastolic-input"
            type="number"
            inputMode="numeric"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            aria-label="舒張壓"
          />
        </label>
        {err && <p role="alert" className="text-xl text-[var(--sc-urgent)]">{err}</p>}
        <button
          type="button"
          data-testid="bp-submit"
          className="btn-elder btn-primary w-full"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? '記低緊……' : '記低'}
        </button>
      </div>
    </Modal>
  );
}

function MedicationModal({
  elderId,
  dbVersion,
  onClose,
  onDone,
}: {
  elderId: string;
  dbVersion: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [medId, setMedId] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: meds } = useAsyncData(async () => {
    if (!elderId) return [];
    return getProvider().list<Medication>(tableNameOf('Medication'), { elderId });
  }, [dbVersion, elderId]);

  const selected = (meds ?? []).find((m) => m.id === (medId || meds?.[0]?.id));

  const submit = async (status: MedicationLog['status']): Promise<void> => {
    const target = medId || meds?.[0]?.id;
    if (!target || status === 'pending') return;
    setBusy(true);
    try {
      await recordMedicationStatus(elderId, target, status);
      onDone(`已記低：${MED_STATUS_LABELS[status]} ✓`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="記錄食藥" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xl font-bold">
          邊種藥？
          <select
            data-testid="med-select"
            value={medId || meds?.[0]?.id || ''}
            onChange={(e) => setMedId(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] bg-white px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
          >
            {(meds ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.dosage}）
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="text-xl text-[var(--sc-ink-soft)]">時間：{selected.schedule}</p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            data-testid="med-taken"
            className="btn-elder btn-ok !px-2"
            onClick={() => void submit('taken')}
            disabled={busy || !selected}
          >
            已服
          </button>
          <button
            type="button"
            data-testid="med-missed"
            className="btn-elder btn-urgent !px-2"
            onClick={() => void submit('missed')}
            disabled={busy || !selected}
          >
            漏服
          </button>
          <button
            type="button"
            data-testid="med-late"
            className="btn-elder btn-primary !px-2"
            onClick={() => void submit('late')}
            disabled={busy || !selected}
          >
            延遲
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FamilyModal({
  elderId,
  caregiverName,
  caregiverPhone,
  caregiverRelation,
  onClose,
  onDone,
}: {
  elderId: string;
  caregiverName: string;
  caregiverPhone: string;
  caregiverRelation: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const notify = async (): Promise<void> => {
    setBusy(true);
    try {
      await notifyFamily(elderId, `${caregiverName}，長者想聯絡你，請盡快回覆。`);
      onDone('已經通知家人 ✓');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="搵家人" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-[var(--sc-idle-soft)] p-4">
          <p className="text-elder-body font-bold">
            {caregiverName}
            {caregiverRelation ? `（${caregiverRelation}）` : ''}
          </p>
          {caregiverPhone && (
            <p className="mt-1 text-xl">
              電話：
              <a
                href={`tel:${caregiverPhone}`}
                className="font-bold text-[var(--sc-idle-deep)] underline underline-offset-4"
              >
                {caregiverPhone}
              </a>
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid="notify-family"
          className="btn-elder btn-primary w-full"
          onClick={() => void notify()}
          disabled={busy}
        >
          {busy ? '通知緊……' : '通知家人'}
        </button>
      </div>
    </Modal>
  );
}

/* ==================== 緊急模式 ==================== */

function EmergencyOverlay({
  response,
  elderId,
  onClose,
  onNotified,
}: {
  response: AssistantResponse;
  elderId: string;
  onClose: () => void;
  onNotified: () => void;
}) {
  const [showCall, setShowCall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alreadyAlert] = useState(Boolean(response.alertId));

  const notify = async (): Promise<void> => {
    if (alreadyAlert) {
      onNotified();
      return;
    }
    setBusy(true);
    try {
      await notifyFamily(elderId, response.answer);
      onNotified();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="emergency-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label="緊急提醒"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--sc-urgent)] p-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-white">
        <span aria-hidden className="animate-breathe text-7xl">⚠️</span>
        <h2 className="text-center font-serif-display text-4xl font-black">緊急提醒</h2>
        <p className="text-center text-elder-body-lg leading-relaxed">{response.answer}</p>
        {response.detailedAnswer && (
          <p className="text-center text-xl leading-relaxed opacity-90">{response.detailedAnswer}</p>
        )}

        {!showCall ? (
          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              data-testid="notify-family"
              className="btn-elder w-full bg-white text-[var(--sc-urgent)]"
              onClick={() => void notify()}
              disabled={busy}
            >
              {busy ? '通知緊……' : alreadyAlert ? '家人已收到通知 ✓' : '通知家人'}
            </button>
            <button
              type="button"
              data-testid="emergency-call"
              className="btn-elder w-full border-2 border-white bg-transparent text-white"
              onClick={() => setShowCall(true)}
            >
              緊急求助
            </button>
            <button
              type="button"
              className="btn-elder w-full bg-black/20 text-white"
              onClick={onClose}
            >
              我冇事，關閉
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <p className="text-center text-xl">澳門緊急求助電話（請自行撥打）：</p>
            <a
              href="tel:999"
              data-testid="emergency-999"
              className="btn-elder w-full bg-white text-[var(--sc-urgent)]"
            >
              📞 999
            </a>
            <a
              href="tel:112"
              className="btn-elder w-full bg-white text-[var(--sc-urgent)]"
            >
              📞 112
            </a>
            <button
              type="button"
              className="btn-elder w-full bg-black/20 text-white"
              onClick={() => setShowCall(false)}
            >
              返回
            </button>
          </div>
        )}
        <p className="text-center text-base opacity-80">{HEALTH_DISCLAIMER}</p>
      </div>
    </div>
  );
}

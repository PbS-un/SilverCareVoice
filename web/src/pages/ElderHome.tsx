/**
 * 老人首頁（路由 '/elder'）：
 * 問候 → 大麥克風（4 狀態色）→ 文字輸入 → 快捷鍵（量血壓／記錄食藥／搵家人）
 * → 回答氣泡（TTS／再講多啲／provider 標記／免責）→ 今日狀態卡 → 歷史對話。
 * 緊急模式（riskLevel urgent）：紅色全屏提醒 + 通知家人 + 緊急求助。
 *
 * 所有數據 DB 實算、subscribe 自動刷新；嚴禁寫死陣列。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ask,
  type AssistantResponse,
  type ContactCardItem,
  type OpenFormSuggestion,
  type PendingAction,
} from '../core/assistant/AssistantService';
import { getProvider } from '../data/DataProvider';
import { demoReset } from '../data/demoReset';
import { tableNameOf } from '../types/entities';
import type { Alert, Appointment, Conversation, HealthEvent } from '../types/entities';
import { isSpeechSupported, startListening, stopListening } from '../services/speech/asr';
import { speak, stopSpeaking } from '../services/speech/tts';
import { notifyFamily, recordBloodPressure } from '../lib/manualEntry';
import { useAsyncData, useDbVersion, useElderContext } from '../lib/hooks';
import { greetingByHour, fmtTime, isToday } from '../lib/format';
import { toSpeechLang, useI18n } from '../i18n';
import BottomNav, { ELDER_NAV_ITEMS } from '../components/BottomNav';
import Modal from '../components/Modal';
import MedicationLogModal from '../components/modals/MedicationLogModal';
import AppointmentModal from '../components/modals/AppointmentModal';
import { ContactCards, MedCandidatesCard, VoiceConfirmCard } from '../components/VoiceConfirmCard';

type MicState = 'idle' | 'listening' | 'thinking' | 'done';

const MIC_STYLE: Record<MicState, string> = {
  idle: 'bg-[var(--sc-idle)]',
  listening: 'bg-[var(--sc-listening)]',
  thinking: 'bg-[var(--sc-thinking)]',
  done: 'bg-[var(--sc-ok)]',
};

const MIC_LABEL_KEY: Record<MicState, string> = {
  idle: 'elder.micIdle',
  listening: 'elder.micListening',
  thinking: 'elder.micThinking',
  done: 'elder.micDone',
};

export default function ElderHome() {
  const { t, locale } = useI18n();
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
  const [modal, setModal] = useState<'bp' | 'med' | 'family' | 'appt' | null>(null);
  /** 門控提議／「改一改」帶入嘅表單預填。 */
  const [formPrefill, setFormPrefill] = useState<OpenFormSuggestion['prefill'] | undefined>(undefined);
  const [toast, setToast] = useState('');
  /** 最後一次已自動播放嘅 assistant conversation id（exactly-once 防重播）。 */
  const autoplayedConvRef = useRef<string | null>(null);
  const micStateRef = useRef<MicState>('idle');
  micStateRef.current = micState;

  /* ---------------- 逃生艙（避免任何情境下永久轉圈） ---------------- */
  // 長者上下文持續為空超過 8 秒（如雲端未配對訪客資料未到位）時，
  // 呈現可操作狀態：「重新載入」與「Demo 重置」。
  const [showRescue, setShowRescue] = useState(false);
  const [rescuing, setRescuing] = useState(false);

  useEffect(() => {
    if (ctx) {
      setShowRescue(false);
      return;
    }
    const t = window.setTimeout(() => setShowRescue(true), 8000);
    return () => window.clearTimeout(t);
  }, [ctx]);

  const doRescueReset = async (): Promise<void> => {
    setRescuing(true);
    try {
      await demoReset(); // 重置後 dbVersion 遞增，useElderContext 自動重讀恢復
    } finally {
      setRescuing(false);
    }
  };

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

  /* 覆診列表（AppointmentModal 地點候選去重用） */
  const { data: appointments } = useAsyncData(async () => {
    if (!elderId) return [];
    return getProvider().list<Appointment>(tableNameOf('Appointment'), { elderId });
  }, [dbVersion, elderId]);

  /* ---------------- 送出訊息（語音／文字同一路徑） ---------------- */

  /**
   * pendingOverride：明確帶入嘅 pending（卡片回調用）；
   * 唔帶就自動沿用上一個 response.pending（追問輪）。
   * 傳 null = 強制唔帶 pending。
   */
  const sendMessage = async (
    raw: string,
    source: 'voice' | 'text',
    pendingOverride?: PendingAction | null,
  ): Promise<void> => {
    const msg = raw.trim();
    if (!msg || !elderId || sending) return;
    setSending(true);
    setErrorMsg('');
    setMicState('thinking');
    setShowDetail(false);
    const pending = pendingOverride === null ? undefined : pendingOverride ?? response?.pending;
    try {
      const res = await ask(elderId, msg, {
        source,
        userName: ctx?.elderName,
        locale,
        ...(pending ? { pending } : {}),
      });
      setResponse(res);
      setMicState('done');
      if (res.riskLevel === 'urgent') setEmergencyOpen(true);
      // T2：每個「新」assistant final answer 自動朗讀一次（exactly once）。
      // 用 assistant Conversation id 區分新舊——rerender／歷史載入／返回頁面
      // 唔會再觸發（autoplay 只在 sendMessage 內發生）；下一個新 answer 再播。
      const convKey = tableNameOf('Conversation');
      const convIds = res.persisted?.[convKey];
      const assistantConvId = convIds?.[convIds.length - 1];
      if (assistantConvId && autoplayedConvRef.current !== assistantConvId) {
        autoplayedConvRef.current = assistantConvId;
        stopSpeaking();
        const ok = speak(res.answer, {
          lang: toSpeechLang(locale),
          onEnd: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
        setSpeaking(ok);
      }
    } catch {
      setErrorMsg(t('elder.error'));
      setMicState('idle');
    } finally {
      setSending(false);
    }
  };

  /* ---------------- 執行門控卡片回調（T16） ---------------- */

  /** 用確認／取消／藥名／數字回覆上一輪 pending。 */
  const replyPending = (msg: string): void => {
    if (!response?.pending) return;
    void sendMessage(msg, 'text', response.pending);
  };

  /** 確認卡「確認記錄」。 */
  const onConfirmCard = (): void => replyPending('啱');

  /** 確認卡「改一改」→ 開對應 Modal 並預填。 */
  const onEditCard = (): void => {
    const c = response?.confirmation;
    if (!c) return;
    if (c.kind === 'appointment') {
      const p = c.payload;
      setFormPrefill({
        ...(p.location ? { location: p.location } : {}),
        ...(p.date ? { date: p.date } : {}),
        ...(p.time ? { time: p.time } : {}),
        ...(p.department ? { specialty: p.department } : {}),
        ...(p.doctor ? { doctor: p.doctor } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...(p.timeTbd ? { timeTbd: true } : {}),
      });
      setModal('appt');
    } else {
      setFormPrefill({ query: c.payload.name });
      setModal('med');
    }
  };

  /** openForm 提議 → 開對應 Modal 並預填。 */
  const openSuggestedForm = (s: OpenFormSuggestion): void => {
    setFormPrefill(s.prefill);
    setModal(s.form === 'medication' ? 'med' : s.form === 'appointment' ? 'appt' : 'bp');
  };

  /** 聯絡卡「通知佢我唔舒服」→ notifyFamily（現有 Alert 流程）。 */
  const onContactNotify = async (item: ContactCardItem): Promise<void> => {
    await notifyFamily(elderId, t('elder.notifyReason', { name: item.name }));
    setToast(t('elder.notifyMsg', { name: item.name }));
  };

  const closeForm = (): void => {
    setModal(null);
    setFormPrefill(undefined);
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
    startListening(
      {
        onInterim: (txt) => setInterim(txt),
        onResult: (txt) => {
          setInterim('');
          setText(txt);
          void sendMessage(txt, 'voice');
        },
        onError: (err) => {
          setErrorMsg(err.message);
          setInterim('');
          setMicState('idle');
        },
        onEnd: () => {
          if (micStateRef.current === 'listening') setMicState('idle');
        },
      },
      toSpeechLang(locale),
    );
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
      lang: toSpeechLang(locale),
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        {showRescue ? (
          <>
            <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
              {t('elder.rescue')}
            </p>
            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                data-testid="elder-reload"
                className="btn-elder btn-primary w-full"
                onClick={() => window.location.reload()}
              >
                {t('elder.reload')}
              </button>
              <button
                type="button"
                data-testid="elder-demo-reset"
                className="btn-elder btn-ghost w-full"
                onClick={() => void doRescueReset()}
                disabled={rescuing}
              >
                {rescuing ? t('role.resetting') : t('role.reset')}
              </button>
            </div>
          </>
        ) : (
          <p className="text-elder-body text-[var(--sc-ink-soft)]" role="status">
            {t('elder.rescueLoading')}
          </p>
        )}
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
        <p className="mt-1 text-elder-body text-[var(--sc-ink-soft)]">{t('elder.question')}</p>
      </header>

      {/* 麥克風（ASR 不支援時自動隱藏，文字輸入常駐） */}
      {speechOk && (
        <section className="mb-6 flex flex-col items-center gap-3" aria-label={t('elder.micLabel')}>
          <button
            type="button"
            data-testid="mic-button"
            aria-label={t(MIC_LABEL_KEY[micState])}
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
            {interim || t(MIC_LABEL_KEY[micState])}
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
        <textarea
          data-testid="text-input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('elder.inputPlaceholder')}
          aria-label={t('elder.inputAria')}
          className="min-h-[80px] w-full resize-none rounded-2xl border-2 border-[var(--sc-line)] bg-white px-4 py-3 text-elder-body outline-none focus:border-[var(--sc-idle)]"
        />
        <button
          type="submit"
          data-testid="send-button"
          aria-label={t('elder.sendAria')}
          className="btn-elder btn-primary shrink-0"
          disabled={sending || text.trim() === ''}
        >
          {sending ? t('elder.sending') : t('elder.send')}
        </button>
      </form>

      {/* 錯誤提示 */}
      {errorMsg && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-xl text-[var(--sc-urgent)]">
          {errorMsg}
        </p>
      )}

      {/* 快捷鍵 */}
      <section aria-label={t('elder.quickAria')} className="mb-6 grid grid-cols-3 gap-3">
        <button
          type="button"
          data-testid="quick-bp"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('bp')}
        >
          <span aria-hidden className="text-3xl">🩺</span>
          {t('elder.quickBp')}
        </button>
        <button
          type="button"
          data-testid="quick-med"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('med')}
        >
          <span aria-hidden className="text-3xl">💊</span>
          {t('elder.quickMed')}
        </button>
        <button
          type="button"
          data-testid="quick-family"
          className="btn-elder btn-ghost flex-col !gap-1 !px-2 text-xl"
          onClick={() => setModal('family')}
        >
          <span aria-hidden className="text-3xl">📞</span>
          {t('elder.quickFamily')}
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
              {t('elder.sourceLabel')}{response.sources.join('、')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="speak-button"
              className="btn-elder btn-primary !min-h-12 !px-4 text-xl"
              onClick={toggleSpeak}
            >
              {speaking ? t('elder.stop') : t('elder.speak')}
            </button>
            {response.detailedAnswer && (
              <button
                type="button"
                data-testid="more-button"
                className="btn-elder btn-ghost !min-h-12 !px-4 text-xl"
                onClick={() => setShowDetail((v) => !v)}
              >
                {showDetail ? t('elder.less') : t('elder.more')}
              </button>
            )}
            <span className="ml-auto rounded-full border border-[var(--sc-line)] px-3 py-1 text-base text-[var(--sc-ink-soft)]">
              {response.provider === 'deepseek'
                ? t('elder.providerDeepseek')
                : response.provider === 'safety'
                  ? t('elder.providerSafety')
                  : t('elder.providerLocal')}
            </span>
          </div>
          <p className="mt-3 text-base text-[var(--sc-muted)]">{t('elder.disclaimer')}</p>
        </section>
      )}

      {/* 執行門控卡片（T16）：確認卡／候選藥／聯絡卡，喺對話流內 */}
      {response?.confirmation && (
        <VoiceConfirmCard
          summary={response.confirmation.summary}
          busy={sending}
          onConfirm={onConfirmCard}
          onEdit={onEditCard}
        />
      )}
      {response?.candidates && response.candidates.length > 0 && (
        <MedCandidatesCard
          candidates={response.candidates}
          busy={sending}
          onSelect={(c) => replyPending(c.name)}
          onNone={() => replyPending('都唔係')}
        />
      )}
      {response?.contactCard && response.contactCard.length > 0 && (
        <ContactCards items={response.contactCard} onNotify={onContactNotify} />
      )}
      {response?.openForm && (
        <button
          type="button"
          data-testid={`open-form-${response.openForm.form}`}
          className="btn-elder btn-primary mb-4 w-full !min-h-14 text-xl"
          onClick={() => openSuggestedForm(response.openForm!)}
        >
          {response.openForm.form === 'medication'
            ? t('elder.openMedForm')
            : response.openForm.form === 'appointment'
              ? t('elder.openApptForm')
              : t('elder.openBpForm')}
        </button>
      )}

      {/* 提示 toast */}
      {toast && (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-xl font-bold text-[var(--sc-ok)]">
          {toast}
        </p>
      )}

      {/* 今日狀態卡（實算） */}
      <section data-testid="today-status" className="card-elder mb-6" aria-label={t('elder.todayStatus')}>
        <h2 className="mb-2 text-xl font-bold text-[var(--sc-ink-soft)]">{t('elder.todayStatus')}</h2>
        {attentionCount === 0 ? (
          <p className="text-elder-body font-bold text-[var(--sc-ok)]">{t('elder.todayNormal')}</p>
        ) : (
          <p className="text-elder-body font-bold text-[var(--sc-thinking)]">
            {t('elder.todayAttention', { n: attentionCount })}
          </p>
        )}
        {familyKnows && <p className="mt-1 text-xl text-[var(--sc-ink-soft)]">{t('elder.familyKnows')}</p>}
      </section>

      {/* 歷史對話 */}
      <section aria-label={t('elder.history')} className="mb-4">
        <h2 className="mb-3 text-elder-title font-serif-display">{t('elder.history')}</h2>
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
                  {c.role === 'elder' ? t('elder.historyYou') : t('elder.historyAssistant')} · {fmtTime(c.createdAt)}
                </span>
                {c.message}
              </div>
            ))}
          {(conversations ?? []).filter((c) => c.role !== 'system').length === 0 && (
            <p className="text-xl text-[var(--sc-muted)]">{t('elder.historyEmpty')}</p>
          )}
        </div>
      </section>

      {/* 彈窗：量血壓 */}
      {modal === 'bp' && (
        <BloodPressureModal
          elderId={elderId}
          initialSystolic={formPrefill?.systolic}
          initialDiastolic={formPrefill?.diastolic}
          onClose={closeForm}
          onDone={(msg) => {
            closeForm();
            onFamilyNotified(msg);
          }}
        />
      )}

      {/* 彈窗：記錄食藥 */}
      {modal === 'med' && (
        <MedicationLogModal
          elderId={elderId}
          dbVersion={dbVersion}
          initialQuery={formPrefill?.query}
          onClose={closeForm}
          onDone={(msg) => {
            closeForm();
            onFamilyNotified(msg);
          }}
        />
      )}

      {/* 彈窗：新增覆診（門控「改一改」／openForm 預填） */}
      {modal === 'appt' && (
        <AppointmentModal
          elderId={elderId}
          appointments={appointments ?? []}
          initial={formPrefill}
          onClose={closeForm}
          onDone={() => {
            closeForm();
            onFamilyNotified(t('elderHealth.savedAppointment'));
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
            onFamilyNotified(t('elder.notified'));
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
  initialSystolic,
  initialDiastolic,
  onClose,
  onDone,
}: {
  elderId: string;
  /** 受控預填（T16）：語音門控已講出嘅上壓值。 */
  initialSystolic?: string;
  /** 受控預填（T16）：語音門控已講出嘅下壓值。 */
  initialDiastolic?: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [sys, setSys] = useState(initialSystolic ?? '');
  const [dia, setDia] = useState(initialDiastolic ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (): Promise<void> => {
    const s = Number(sys);
    const d = Number(dia);
    if (!s || !d || s < 50 || s > 260 || d < 30 || d > 160) {
      setErr(t('bp.invalid'));
      return;
    }
    setBusy(true);
    try {
      const { events } = await recordBloodPressure(elderId, s, d);
      const worst = events.some((e) => e.severity === 'urgent')
        ? t('bp.doneUrgent')
        : events.length > 0
          ? t('bp.doneAttention')
          : t('bp.doneNormal');
      onDone(worst);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('bp.title')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-xl font-bold">
          {t('vital.systolic')}
          <input
            data-testid="bp-systolic-input"
            type="number"
            inputMode="numeric"
            value={sys}
            onChange={(e) => setSys(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            aria-label={t('vital.systolic')}
          />
        </label>
        <label className="flex flex-col gap-1 text-xl font-bold">
          {t('vital.diastolic')}
          <input
            data-testid="bp-diastolic-input"
            type="number"
            inputMode="numeric"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-[var(--sc-line)] px-4 text-elder-body outline-none focus:border-[var(--sc-idle)]"
            aria-label={t('vital.diastolic')}
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
          {busy ? t('bp.saving') : t('bp.save')}
        </button>
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
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const notify = async (): Promise<void> => {
    setBusy(true);
    try {
      await notifyFamily(elderId, t('familyModal.msg', { name: caregiverName }));
      onDone(t('elder.notified'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('familyModal.title')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-[var(--sc-idle-soft)] p-4">
          <p className="text-elder-body font-bold">
            {caregiverName}
            {caregiverRelation ? `（${caregiverRelation}）` : ''}
          </p>
          {caregiverPhone && (
            <p className="mt-1 text-xl">
              {t('familyModal.phone')}
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
          {busy ? t('familyModal.notifying') : t('familyModal.notify')}
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
  const { t } = useI18n();
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
      aria-label={t('emergency.title')}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--sc-urgent)] p-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-white">
        <span aria-hidden className="animate-breathe text-7xl">⚠️</span>
        <h2 className="text-center font-serif-display text-4xl font-black">{t('emergency.title')}</h2>
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
              {busy
                ? t('familyModal.notifying')
                : alreadyAlert
                  ? t('emergency.familyNotified')
                  : t('emergency.notifyFamily')}
            </button>
            <button
              type="button"
              data-testid="emergency-call"
              className="btn-elder w-full border-2 border-white bg-transparent text-white"
              onClick={() => setShowCall(true)}
            >
              {t('emergency.call')}
            </button>
            <button
              type="button"
              className="btn-elder w-full bg-black/20 text-white"
              onClick={onClose}
            >
              {t('emergency.close')}
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <p className="text-center text-xl">{t('emergency.macaoNumber')}</p>
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
              {t('emergency.back')}
            </button>
          </div>
        )}
        <p className="text-center text-base opacity-80">{t('elder.disclaimer')}</p>
      </div>
    </div>
  );
}

/**
 * slowSpeech.ts — 長者慢速／斷句語音緩衝（T6）
 *
 * 高齡長者會停頓再講（例如「今日血壓……一百五十八……九十五……」），
 * 系統唔應該因為中間停頓就提早停止：
 *  - continuous listening（browser 支援時）
 *  - interimResults = true
 *  - 多個 recognition chunk 先聚合，再一次過送入 AI pipeline
 *  - 最後一次 speech/result 後等 silenceMs（預設 8 秒）先 finalize
 *  - absolute max recording duration（預設 35 秒）防止永遠唔停
 *  - 冇任何 speech → 以 gentle retry state 通知 UI（唔會話「識別失敗」）
 */
import { startListening, stopListening, type AsrCallbacks } from './asr';

export type SlowSpeechState =
  | 'listening' // 正在聽（未收到任何字）
  | 'pausing' // 收到過內容，等待繼續講
  | 'processing' // 已收尾，處理緊聚合 transcript
  | 'repeat' // 冇內容／太短 → 請長者慢慢再講一次
  | 'done' // 完成
  | 'idle';

export interface SlowSpeechOptions {
  lang: string;
  /** 靜音容忍（最後一次 speech/result 後等待），預設 8000ms。 */
  silenceMs?: number;
  /** 最長錄音時限，預設 35000ms。 */
  maxMs?: number;
  onInterim?: (text: string) => void;
  /** 聚合後嘅完整 transcript（或空字串表示冇內容）。 */
  onFinal?: (text: string) => void;
  onState?: (state: SlowSpeechState) => void;
}

interface ActiveSession {
  chunks: string[];
  lastActivity: number;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  finished: boolean;
}

let active: ActiveSession | null = null;

const DEFAULT_SILENCE_MS = 8_000;
const DEFAULT_MAX_MS = 35_000;
/** 未開始講話前嘅「準備期」寬限（長者可能遲幾秒先開聲）。 */
const INITIAL_SILENCE_MS = 10_000;

function clearTimers(session: ActiveSession): void {
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  if (session.maxTimer) clearTimeout(session.maxTimer);
  session.silenceTimer = null;
  session.maxTimer = null;
}

/** 開始慢速語音聆聽。同時間只有一個 session。 */
export function startSlowListening(options: SlowSpeechOptions): void {
  if (active) stopSlowListening();

  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const session: ActiveSession = {
    chunks: [],
    lastActivity: Date.now(),
    silenceTimer: null,
    maxTimer: null,
    finished: false,
  };
  active = session;

  const emitState = (state: SlowSpeechState): void => {
    if (session.finished && state !== 'done' && state !== 'idle') return;
    options.onState?.(state);
  };

  const armTimers = (): void => {
    clearTimers(session);
    session.lastActivity = Date.now();
    // 靜音超過 silenceMs → 收尾
    session.silenceTimer = setTimeout(() => {
      if (!session.finished) stopListening();
    }, silenceMs);
    // 絕對上限：唔俾錄音 hang 死
    session.maxTimer = setTimeout(() => {
      if (!session.finished) stopListening();
    }, maxMs);
  };

  // 未開始講話前：只有一個較寬鬆嘅準備期 + 絕對上限
  session.silenceTimer = setTimeout(() => {
    if (!session.finished) stopListening();
  }, INITIAL_SILENCE_MS);
  session.maxTimer = setTimeout(() => {
    if (!session.finished) stopListening();
  }, maxMs);

  const finalize = (): void => {
    if (session.finished) return;
    session.finished = true;
    clearTimers(session);
    const text = session.chunks.join('').replace(/[，,。.、\s]+$/g, '').trim();
    if (text) {
      options.onState?.('processing');
      options.onFinal?.(text);
      options.onState?.('done');
    } else {
      // 冇內容 → gentle retry（唔會顯示「識別失敗」）
      options.onState?.('repeat');
      options.onFinal?.('');
      options.onState?.('done');
    }
    active = null;
  };

  const callbacks: AsrCallbacks = {
    onInterim: (t) => {
      if (session.finished) return;
      armTimers();
      options.onInterim?.(t);
      emitState(session.chunks.length > 0 ? 'pausing' : 'listening');
    },
    onResult: (chunk) => {
      if (session.finished) return;
      const c = (chunk ?? '').trim();
      if (!c) return;
      session.chunks.push(c);
      armTimers();
      options.onInterim?.('');
      // 收到內容 → 「等待繼續講」狀態（唔會即刻提交）
      emitState('pausing');
    },
    onError: () => {
      // 任何 error（含 no-speech）都唔話「識別失敗」：以 gentle retry 收尾
      finalize();
    },
    onEnd: () => {
      finalize();
    },
  };

  emitState('listening');
  startListening(callbacks, options.lang, { continuous: true });
}

/** 手動停止慢速語音（例如切頁）；會以已聚合內容收尾。 */
export function stopSlowListening(): void {
  if (!active) return;
  stopListening();
}

/** 目前是否正在慢速聆聽。 */
export function isSlowListening(): boolean {
  return active !== null;
}

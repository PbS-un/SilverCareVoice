/**
 * tts.ts — 語音合成（TTS）層
 *
 * 封裝瀏覽器原生 speechSynthesis，專為長者粵語場景調校：
 *  - 預設 rate ≈ 0.8（放慢語速）、pitch 正常
 *  - 語音選擇優先序：zh-HK 精確 → zh-HK 前綴 → zh-Hant → yue（粵語）→ 其他 zh
 *  - cancel-on-new：新語句到來立即取消上一句
 *  - 處理 voiceschanged 非同步載入（Chrome 首次 getVoices() 常為空）
 *
 * 絕不拋錯：不支援時回傳 false 並透過 onError 通知，UI 自行決定呈現。
 */

/** TTS 預設語言 */
export const TTS_LANG = 'zh-HK';
/** 長者友善語速：比預設（1）慢 */
export const DEFAULT_RATE = 0.8;
/** 正常音高 */
export const DEFAULT_PITCH = 1;

export type TtsErrorCode = 'unsupported' | 'synthesis-error';

export interface TtsError {
  code: TtsErrorCode;
  message: string;
  raw?: unknown;
}

export interface TtsOptions {
  /** 預設 'zh-HK' */
  lang?: string;
  /** 預設 0.8 */
  rate?: number;
  /** 預設 1 */
  pitch?: number;
  /** 預設 1 */
  volume?: number;
  /** 僅「最新一句」的事件會觸發回調；被取消的舊句一律靜默 */
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: TtsError) => void;
}

export interface TtsDeps {
  /** 覆寫 speechSynthesis 來源（測試／客製引擎用） */
  getSynthesis?: () => SpeechSynthesis | undefined;
}

export interface TtsInstance {
  isSupported(): boolean;
  /** 返回 true 表示已成功排入播放；失敗走 opts.onError，絕不拋錯 */
  speak(text: string, opts?: TtsOptions): boolean;
  stop(): void;
}

/* ------------------------------------------------------------------ */
/* 內部工具                                                            */
/* ------------------------------------------------------------------ */

function defaultGetSynthesis(): SpeechSynthesis | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.speechSynthesis;
}

/** 上層 callbacks 拋錯不能影響 TTS 層本身 */
function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // 刻意吞掉：回調異常不允許讓語音層崩潰
  }
}

function normalizeLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, '-');
}

/**
 * 語音匹配評分：越高越適合粵語長者場景。
 * 0 = 完全不匹配（絕不選中）。
 */
function rankVoice(voice: SpeechSynthesisVoice, lang: string): number {
  const v = normalizeLang(voice.lang ?? '');
  const want = normalizeLang(lang);
  if (!v) return 0;
  if (v === want) return 100; // zh-hk 精確
  if (v.startsWith(`${want}-`)) return 90; // zh-hk-* 變體
  if (want.startsWith('zh')) {
    if (v.startsWith('zh-hant')) return 80; // 繁中（zh-TW / zh-Hant-HK 等）
    if (v.startsWith('yue')) return 75; // 粵語（yue-HK 等）
    if (v.startsWith('zh')) return 60; // 其他中文（zh-CN 等，寧可讀也要讀得出）
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* 工廠                                                                */
/* ------------------------------------------------------------------ */

export function createTts(deps: TtsDeps = {}): TtsInstance {
  const getSynthesis = deps.getSynthesis ?? defaultGetSynthesis;
  let current: SpeechSynthesisUtterance | null = null;
  let voicesChangedBound = false;

  function isSupported(): boolean {
    try {
      const synth = getSynthesis();
      return (
        !!synth &&
        typeof synth.speak === 'function' &&
        typeof SpeechSynthesisUtterance !== 'undefined'
      );
    } catch {
      return false;
    }
  }

  /**
   * 從已載入的 voices 中挑最合適的；若清單還是空的
   * （Chrome 非同步載入），註冊一次 voiceschanged 監聽，
   * 待聲音清單就绪後下一次 speak 自然選中正確語音。
   */
  function pickVoice(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
    let voices: SpeechSynthesisVoice[] = [];
    try {
      voices = synth.getVoices() ?? [];
    } catch {
      voices = [];
    }
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = 0;
    for (const voice of voices) {
      const score = rankVoice(voice, lang);
      if (score > bestScore) {
        bestScore = score;
        best = voice;
      }
    }
    if (!best && !voicesChangedBound) {
      voicesChangedBound = true;
      try {
        // voices 就绪後無需其他動作——下次 speak 會重新掃描清單
        synth.addEventListener('voiceschanged', () => undefined, { once: true });
      } catch {
        // 極端環境不支援事件綁定也無妨，僅損失自動重選
      }
    }
    return best;
  }

  function speak(text: string, opts: TtsOptions = {}): boolean {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return false;

    const synth = getSynthesis();
    if (
      !synth ||
      typeof synth.speak !== 'function' ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      safeCall(() =>
        opts.onError?.({
          code: 'unsupported',
          message: '此瀏覽器不支援語音朗讀。',
        }),
      );
      return false;
    }

    // cancel-on-new：新語句到來，立即取消上一句。
    // 先把 current 清空再 cancel，讓舊句被中斷時觸發的
    // error/end 事件（Chrome 會補發 'interrupted'/'canceled'）被靜默忽略。
    current = null;
    try {
      synth.cancel();
    } catch {
      // cancel 失敗不影響新句播放
    }

    const lang = opts.lang ?? TTS_LANG;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = lang;
    utterance.rate = opts.rate ?? DEFAULT_RATE;
    utterance.pitch = opts.pitch ?? DEFAULT_PITCH;
    utterance.volume = opts.volume ?? 1;

    const voice = pickVoice(synth, lang);
    if (voice) utterance.voice = voice;

    utterance.onstart = (): void => {
      if (utterance !== current) return;
      safeCall(() => opts.onStart?.());
    };
    utterance.onend = (): void => {
      if (utterance !== current) return;
      current = null;
      safeCall(() => opts.onEnd?.());
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent): void => {
      if (utterance !== current) return; // 被取消／取代的舊句，不上報
      current = null;
      const reason = event?.error ?? 'unknown';
      if (reason === 'interrupted' || reason === 'canceled') return;
      safeCall(() =>
        opts.onError?.({
          code: 'synthesis-error',
          message: `語音朗讀失敗（${reason}）。`,
          raw: reason,
        }),
      );
    };

    current = utterance;
    try {
      synth.speak(utterance);
      return true;
    } catch (err) {
      current = null;
      safeCall(() =>
        opts.onError?.({
          code: 'synthesis-error',
          message: '語音朗讀啟動失敗。',
          raw: err,
        }),
      );
      return false;
    }
  }

  function stop(): void {
    current = null;
    const synth = getSynthesis();
    if (!synth) return;
    try {
      synth.cancel();
    } catch {
      // cancel 失敗亦不拋錯
    }
  }

  return { isSupported, speak, stop };
}

/* ------------------------------------------------------------------ */
/* 預設實例與模組級便捷 API                                            */
/* ------------------------------------------------------------------ */

const defaultTts = createTts();

/** 能力偵測：瀏覽器是否支援語音合成（絕不拋錯） */
export function isTtsSupported(): boolean {
  return defaultTts.isSupported();
}

/**
 * 朗讀一句。新語句會取消上一句（cancel-on-new）。
 * 返回 true 表示已排入播放；不支援／失敗走 opts.onError，絕不拋錯。
 */
export function speak(text: string, opts?: TtsOptions): boolean {
  return defaultTts.speak(text, opts);
}

/** 停止朗讀；沒有播放中內容時為 no-op，絕不拋錯 */
export function stopSpeaking(): void {
  defaultTts.stop();
}

/**
 * asr.ts — 語音辨識（ASR）層
 *
 * 封裝瀏覽器原生 Web Speech API（SpeechRecognition / webkitSpeechRecognition），
 * 預設語言為粵語 `zh-HK`、開啟 interimResults、continuous=false（一句一結算）。
 *
 * 設計原則：
 *  1. 絕不拋錯：不支援、麥克風被拒、網路失敗……一律透過 onError 帶明確
 *     AsrErrorCode 通知，由 UI 層 fallback 到文字輸入，App 永不崩潰。
 *  2. 注入縫隙：`createAsr({ injectTranscript, getRecognitionCtor })`
 *     允許測試或外部轉寫來源（如伺服器端 ASR）接入，屬產品級依賴注入接口。
 *  3. 零第三方依賴：只用瀏覽器內建能力。
 */

/** 預設辨識語言：粵語（港澳） */
export const ASR_LANG = 'zh-HK';

/** ASR 錯誤碼（穩定對外合約，UI 可據此決定 fallback 文案） */
export type AsrErrorCode =
  | 'unsupported' // 瀏覽器不支援 Web Speech API / 語言不支援
  | 'no-speech' // 未偵測到任何語音
  | 'audio-capture' // 找不到麥克風／音訊擷取失敗
  | 'permission-denied' // 使用者拒絕麥克風權限
  | 'network' // 辨識需連網，網路錯誤
  | 'aborted' // 辨識被中止
  | 'internal'; // 其他未分類錯誤

export interface AsrError {
  code: AsrErrorCode;
  /** 人類可讀訊息（繁體中文，可直接給長者 UI 使用） */
  message: string;
  /** 原始錯誤資訊，供除錯／上報 */
  raw?: unknown;
}

export interface AsrCallbacks {
  /** 中間轉寫（打字機效果用），可選 */
  onInterim?: (text: string) => void;
  /** 最終轉寫結果 */
  onResult: (text: string) => void;
  /** 出錯時必帶明確原因；收到後請 fallback 到文字輸入 */
  onError: (error: AsrError) => void;
  /** 本次聆聽結束（成功或失敗後保證恰好觸發一次） */
  onEnd?: () => void;
}

/* ------------------------------------------------------------------ */
/* 最小結構化型別：TS DOM lib 未含 SpeechRecognition，自行定義         */
/* ------------------------------------------------------------------ */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: ((event: unknown) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/* ------------------------------------------------------------------ */
/* 注入縫隙（產品級 DI 接口）                                          */
/* ------------------------------------------------------------------ */

/**
 * 注入模式下的轉寫通道。外部來源（測試、伺服器 ASR、硬體設備…）
 * 透過此 handle 把結果推進給 ASR 層，與原生辨識共用同一套 callbacks 合約。
 */
export interface AsrTranscriptHandle {
  /** 推送中間轉寫 */
  interim(text: string): void;
  /** 推送最終轉寫；推送後本次聆聽自動結束 */
  final(text: string): void;
  /** 回報錯誤並結束本次聆聽 */
  error(error: AsrError): void;
  /** 直接結束本次聆聽 */
  end(): void;
}

/**
 * 轉寫注入器：接收 handle，回傳可選的清理函式。
 * `stop()` 時清理函式會被呼叫，清理後若未自行呼叫 handle.end()，
 * ASR 層會保證 onEnd 仍恰好觸發一次。
 */
export type TranscriptInjector = (handle: AsrTranscriptHandle) => (() => void) | void;

export interface AsrDeps {
  /** 注入外部轉寫來源；提供後 isSupported() 恆為 true */
  injectTranscript?: TranscriptInjector;
  /** 覆寫 SpeechRecognition 建構子來源（測試／客製引擎用） */
  getRecognitionCtor?: () => SpeechRecognitionCtor | undefined;
}

export interface AsrInstance {
  isSupported(): boolean;
  start(callbacks: AsrCallbacks): void;
  stop(): void;
}

interface ActiveSession {
  /** 優雅停止：讓引擎補完最後一句再收尾 */
  stop(): void;
  /** 強制終止：切斷回調、abort、立即收尾 */
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* 內部工具                                                            */
/* ------------------------------------------------------------------ */

function defaultGetRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function mapErrorCode(raw: string | undefined): AsrErrorCode {
  switch (raw) {
    case 'no-speech':
      return 'no-speech';
    case 'audio-capture':
      return 'audio-capture';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    case 'language-not-supported':
      return 'unsupported';
    default:
      return 'internal';
  }
}

function describeError(code: AsrErrorCode): string {
  switch (code) {
    case 'unsupported':
      return '此瀏覽器不支援語音輸入，請改用文字輸入。';
    case 'no-speech':
      return '聽唔到您講嘢，請再試一次。';
    case 'audio-capture':
      return '找不到麥克風，請檢查裝置。';
    case 'permission-denied':
      return '請允許使用麥克風權限。';
    case 'network':
      return '網路連線問題，請檢查網路後再試。';
    case 'aborted':
      return '語音輸入已中止。';
    default:
      return '語音輸入出現問題，請改用文字輸入。';
  }
}

/** 上層 callbacks 拋錯不能影響 ASR 層本身 */
function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // 刻意吞掉：回調異常不允許讓語音層崩潰
  }
}

/* ------------------------------------------------------------------ */
/* 工廠                                                                */
/* ------------------------------------------------------------------ */

export function createAsr(deps: AsrDeps = {}): AsrInstance {
  const getCtor = deps.getRecognitionCtor ?? defaultGetRecognitionCtor;
  let active: ActiveSession | null = null;

  function isSupported(): boolean {
    if (deps.injectTranscript) return true;
    try {
      return getCtor() != null;
    } catch {
      return false;
    }
  }

  function start(callbacks: AsrCallbacks): void {
    // 上一段聆聽未結束：先乾淨收尾，避免重複收音
    if (active) {
      active.dispose();
      active = null;
    }

    let ended = false;
    let disposed = false;
    let stopRequested = false;
    let recognition: SpeechRecognitionLike | null = null;
    let injectorCleanup: (() => void) | undefined;

    const endSession = (): void => {
      if (ended) return;
      ended = true;
      if (active === handle) active = null;
      safeCall(() => callbacks.onEnd?.());
    };

    const fail = (error: AsrError): void => {
      if (ended) return;
      safeCall(() => callbacks.onError(error));
      endSession();
    };

    const handle: ActiveSession = {
      stop(): void {
        if (ended || disposed) return;
        stopRequested = true;
        if (recognition) {
          try {
            // 優雅停止：讓引擎把最後一句結算完，靠 onresult/onend 收尾
            recognition.stop();
          } catch {
            handle.dispose();
          }
          return;
        }
        // 注入模式：呼叫清理函式；無論注入器有否自行收尾，
        // 這裡保證 onEnd 恰好觸發一次（endSession 具冪等性）
        if (injectorCleanup) {
          const cleanup = injectorCleanup;
          injectorCleanup = undefined;
          try {
            cleanup();
          } catch {
            // 清理函式異常不影響收尾
          }
        }
        endSession();
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        if (recognition) {
          // 先拆掉回調，避免 abort 後的 onerror/onend 雜訊
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          try {
            recognition.abort();
          } catch {
            // 部分實作 abort 可能拋錯，忽略
          }
          recognition = null;
        }
        if (injectorCleanup) {
          const cleanup = injectorCleanup;
          injectorCleanup = undefined;
          try {
            cleanup();
          } catch {
            // 清理函式異常不影響收尾
          }
        }
        endSession();
      },
    };
    active = handle;

    /* ---------- 注入轉寫來源（測試／外部 ASR 引擎） ---------- */
    if (deps.injectTranscript) {
      const emit: AsrTranscriptHandle = {
        interim: (text: string): void => {
          if (ended || !text) return;
          safeCall(() => callbacks.onInterim?.(text));
        },
        final: (text: string): void => {
          if (ended || !text) return;
          safeCall(() => callbacks.onResult(text));
          endSession();
        },
        error: (error: AsrError): void => fail(error),
        end: (): void => endSession(),
      };
      try {
        const cleanup = deps.injectTranscript(emit);
        if (typeof cleanup === 'function') injectorCleanup = cleanup;
      } catch (err) {
        fail({
          code: 'internal',
          message: '外部轉寫來源啟動失敗，請改用文字輸入。',
          raw: err,
        });
      }
      return;
    }

    /* ---------- 瀏覽器原生 Web Speech API ---------- */
    const Ctor = getCtor();
    if (!Ctor) {
      fail({
        code: 'unsupported',
        message: describeError('unsupported'),
      });
      return;
    }

    let instance: SpeechRecognitionLike;
    try {
      instance = new Ctor();
    } catch (err) {
      fail({
        code: 'unsupported',
        message: describeError('unsupported'),
        raw: err,
      });
      return;
    }
    recognition = instance;

    instance.lang = ASR_LANG;
    instance.interimResults = true;
    instance.continuous = false;

    instance.onresult = (event: SpeechRecognitionEventLike): void => {
      if (ended) return;
      let interimText = '';
      let finalText = '';
      const results = event.results;
      const startIndex = Math.max(0, event.resultIndex ?? 0);
      for (let i = startIndex; i < results.length; i += 1) {
        const result = results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText) {
        safeCall(() => callbacks.onInterim?.(interimText));
      }
      if (finalText) {
        safeCall(() => callbacks.onResult(finalText.trim()));
        // continuous=false：拿到 final 即本次聆聽完成
        endSession();
      }
    };

    instance.onerror = (event: SpeechRecognitionErrorEventLike): void => {
      if (ended || disposed) return;
      const code = mapErrorCode(event?.error);
      // 主動停止後引擎補發的 aborted 屬正常中斷，交由 onend 收尾，不上報
      if (code === 'aborted' && stopRequested) return;
      fail({ code, message: describeError(code), raw: event?.error });
    };

    instance.onend = (): void => {
      if (disposed) return;
      endSession();
    };

    try {
      instance.start();
    } catch (err) {
      fail({
        code: 'internal',
        message: describeError('internal'),
        raw: err,
      });
    }
  }

  function stop(): void {
    if (!active) return;
    active.stop();
  }

  return { isSupported, start, stop };
}

/* ------------------------------------------------------------------ */
/* 預設實例與模組級便捷 API                                            */
/* ------------------------------------------------------------------ */

const defaultAsr = createAsr();

/** 能力偵測：瀏覽器是否支援語音辨識（絕不拋錯） */
export function isSpeechSupported(): boolean {
  return defaultAsr.isSupported();
}

/** 開始聆聽（zh-HK）；不支援／出錯會走 callbacks.onError，絕不拋錯 */
export function startListening(callbacks: AsrCallbacks): void {
  defaultAsr.start(callbacks);
}

/** 停止聆聽；沒有進行中的聆聽時為 no-op，絕不拋錯 */
export function stopListening(): void {
  defaultAsr.stop();
}

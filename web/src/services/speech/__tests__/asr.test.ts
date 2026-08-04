/**
 * asr.test.ts — ASR 層單測（Vitest + jsdom）
 *
 * jsdom 本身沒有 Web Speech API，正好覆蓋「無 API 環境」的能力偵測與
 * fallback 路徑；原生辨識行為則透過 getRecognitionCtor 注入 Fake 實作驗證。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASR_LANG,
  createAsr,
  isSpeechSupported,
  startListening,
  stopListening,
  type AsrError,
  type AsrTranscriptHandle,
} from '../asr';

/* ------------------------------------------------------------------ */
/* Fake SpeechRecognition（結構與瀏覽器實作一致）                        */
/* ------------------------------------------------------------------ */

type Handler = ((event: never) => void) | null;

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  lang = '';
  interimResults = false;
  continuous = true;

  onstart: Handler = null;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;

  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
    // 模擬真實引擎：stop 後異步收尾
    this.onend?.({} as never);
  }

  abort(): void {
    this.abortCalls += 1;
  }
}

function resultEvent(transcript: string, isFinal: boolean): never {
  return {
    resultIndex: 0,
    results: { length: 1, 0: { isFinal, length: 1, 0: { transcript } } },
  } as never;
}

function makeCallbacks() {
  return {
    onInterim: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
  };
}

beforeEach(() => {
  FakeRecognition.instances = [];
});

/* ------------------------------------------------------------------ */
/* 能力偵測                                                             */
/* ------------------------------------------------------------------ */

describe('能力偵測', () => {
  it('無 Web Speech API 環境回傳 false 且不拋錯', () => {
    expect(() => isSpeechSupported()).not.toThrow();
    expect(isSpeechSupported()).toBe(false);
    expect(createAsr().isSupported()).toBe(false);
  });

  it('注入 Recognition 建構子後回傳 true', () => {
    const asr = createAsr({
      getRecognitionCtor: () => FakeRecognition as unknown as never,
    });
    expect(asr.isSupported()).toBe(true);
  });

  it('getRecognitionCtor 回傳 undefined 時回傳 false', () => {
    const asr = createAsr({ getRecognitionCtor: () => undefined });
    expect(asr.isSupported()).toBe(false);
  });

  it('提供 injectTranscript 時視為有外部轉寫來源（supported）', () => {
    const asr = createAsr({ injectTranscript: () => undefined });
    expect(asr.isSupported()).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* fallback 路徑（不支援時絕不崩潰）                                    */
/* ------------------------------------------------------------------ */

describe('fallback 路徑', () => {
  it('不支援環境 startListening 不拋錯，onError 帶 unsupported 且 onEnd 恰好一次', () => {
    const cb = makeCallbacks();
    expect(() => startListening(cb)).not.toThrow();
    expect(cb.onError).toHaveBeenCalledTimes(1);
    const error: AsrError = cb.onError.mock.calls[0][0];
    expect(error.code).toBe('unsupported');
    expect(error.message.length).toBeGreaterThan(0);
    expect(cb.onResult).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('startListening 之後再呼叫 onError，session 已結束不再重複回調', () => {
    const cb = makeCallbacks();
    startListening(cb);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    stopListening(); // no-op，不拋錯
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('無 session 時 stopListening 為 no-op', () => {
    expect(() => stopListening()).not.toThrow();
  });

  it('Recognition 建構時拋錯也走 onError 而非崩潰', () => {
    const asr = createAsr({
      getRecognitionCtor: () =>
        class {
          constructor() {
            throw new Error('boom');
          }
        } as unknown as never,
    });
    const cb = makeCallbacks();
    expect(() => asr.start(cb)).not.toThrow();
    expect(cb.onError.mock.calls[0][0].code).toBe('unsupported');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('recognition.start() 拋錯時回報 internal 錯誤', () => {
    class ThrowingStart extends FakeRecognition {
      override start(): void {
        throw new Error('start failed');
      }
    }
    const asr = createAsr({
      getRecognitionCtor: () => ThrowingStart as unknown as never,
    });
    const cb = makeCallbacks();
    expect(() => asr.start(cb)).not.toThrow();
    expect(cb.onError.mock.calls[0][0].code).toBe('internal');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 注入縫隙（產品級 DI 接口）                                           */
/* ------------------------------------------------------------------ */

describe('注入縫隙 createAsr({ injectTranscript })', () => {
  it('注入 interim / final 結果走同一套 callbacks 合約', () => {
    const asr = createAsr({
      injectTranscript: (handle) => {
        handle.interim('你好');
        handle.final('你好世界');
        return () => undefined;
      },
    });
    const cb = makeCallbacks();
    asr.start(cb);
    expect(cb.onInterim).toHaveBeenCalledWith('你好');
    expect(cb.onResult).toHaveBeenCalledWith('你好世界');
    expect(cb.onError).not.toHaveBeenCalled();
    // final 後自動結束
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('stop() 會呼叫注入器清理函式，且保證 onEnd 恰好一次', () => {
    const cleanup = vi.fn();
    const asr = createAsr({
      injectTranscript: () => cleanup,
    });
    const cb = makeCallbacks();
    asr.start(cb);
    expect(cleanup).not.toHaveBeenCalled();
    asr.stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    // 重複 stop 不重複收尾
    asr.stop();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('注入器可自行呼叫 handle.end()，onEnd 仍恰好一次（冪等）', () => {
    const asr = createAsr({
      injectTranscript: (handle) => {
        return () => handle.end();
      },
    });
    const cb = makeCallbacks();
    asr.start(cb);
    asr.stop();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('注入器可用 handle.error 回報明確錯誤原因', () => {
    const asr = createAsr({
      injectTranscript: (handle) => {
        handle.error({ code: 'network', message: '外部 ASR 服務斷線' });
      },
    });
    const cb = makeCallbacks();
    asr.start(cb);
    expect(cb.onError.mock.calls[0][0].code).toBe('network');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('注入器啟動時拋錯 → onError(internal)，不崩潰', () => {
    const asr = createAsr({
      injectTranscript: () => {
        throw new Error('injector boom');
      },
    });
    const cb = makeCallbacks();
    expect(() => asr.start(cb)).not.toThrow();
    expect(cb.onError.mock.calls[0][0].code).toBe('internal');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('session 結束後注入器再推送結果不會回調', () => {
    const handleRef: { current: AsrTranscriptHandle | null } = { current: null };
    const asr = createAsr({
      injectTranscript: (handle) => {
        handleRef.current = handle;
      },
    });
    const cb = makeCallbacks();
    asr.start(cb);
    asr.stop();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    handleRef.current?.interim('遲到的結果');
    handleRef.current?.final('遲到的結果');
    expect(cb.onInterim).not.toHaveBeenCalled();
    expect(cb.onResult).not.toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 原生辨識封裝行為                                                     */
/* ------------------------------------------------------------------ */

describe('原生 Web Speech API 封裝', () => {
  function startNative() {
    const asr = createAsr({
      getRecognitionCtor: () => FakeRecognition as unknown as never,
    });
    const cb = makeCallbacks();
    asr.start(cb);
    const recognition = FakeRecognition.instances[FakeRecognition.instances.length - 1];
    expect(recognition).toBeDefined();
    return { asr, cb, recognition };
  }

  it('配置 zh-HK、interimResults=true、continuous=false 並啟動', () => {
    const { recognition } = startNative();
    expect(recognition.lang).toBe(ASR_LANG);
    expect(recognition.lang).toBe('zh-HK');
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(false);
    expect(recognition.startCalls).toBe(1);
  });

  it('interim 結果 → onInterim；final 結果 → onResult + onEnd 恰好一次', () => {
    const { cb, recognition } = startNative();
    recognition.onresult?.(resultEvent('食咗', false));
    expect(cb.onInterim).toHaveBeenCalledWith('食咗');
    expect(cb.onResult).not.toHaveBeenCalled();

    recognition.onresult?.(resultEvent('食咗飯未呀', true));
    expect(cb.onResult).toHaveBeenCalledWith('食咗飯未呀');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);

    // continuous=false：引擎隨後收尾，不重複觸發 onEnd
    recognition.onend?.({} as never);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('onerror not-allowed → permission-denied，之後 onend 收尾恰一次', () => {
    const { cb, recognition } = startNative();
    recognition.onerror?.({ error: 'not-allowed' } as never);
    expect(cb.onError.mock.calls[0][0].code).toBe('permission-denied');
    recognition.onend?.({} as never);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('錯誤碼映射：no-speech / audio-capture / network / language-not-supported', () => {
    const cases: Array<[string, AsrError['code']]> = [
      ['no-speech', 'no-speech'],
      ['audio-capture', 'audio-capture'],
      ['network', 'network'],
      ['language-not-supported', 'unsupported'],
      ['weird-new-code', 'internal'],
    ];
    for (const [raw, expected] of cases) {
      const { cb, recognition } = startNative();
      recognition.onerror?.({ error: raw } as never);
      expect(cb.onError.mock.calls[0][0].code).toBe(expected);
      expect(cb.onEnd).toHaveBeenCalledTimes(1);
    }
  });

  it('stop() 走優雅停止：stopCalls+1，之後 aborted 錯誤被靜默、onend 收尾', () => {
    const { asr, cb, recognition } = startNative();
    asr.stop();
    expect(recognition.stopCalls).toBe(1);
    // FakeRecognition.stop 同步觸發 onend → 已收尾
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
    // 引擎補發 aborted 不再上報（session 已結束）
    recognition.onerror?.({ error: 'aborted' } as never);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('主動 stop 後引擎補發 aborted：被靜默，靠 onend 收尾', () => {
    const asr = createAsr({
      getRecognitionCtor: () =>
        class extends FakeRecognition {
          override stop(): void {
            this.stopCalls += 1;
            // 不立即 onend，模擬真實異步收尾
          }
        } as unknown as never,
    });
    const cb = makeCallbacks();
    asr.start(cb);
    const recognition = FakeRecognition.instances[0];
    asr.stop();
    expect(recognition.stopCalls).toBe(1);
    recognition.onerror?.({ error: 'aborted' } as never);
    expect(cb.onError).not.toHaveBeenCalled();
    recognition.onend?.({} as never);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('重複 start：先 abort 舊 session 再開新的，舊回調不再生效', () => {
    const asr = createAsr({
      getRecognitionCtor: () => FakeRecognition as unknown as never,
    });
    const cb1 = makeCallbacks();
    const cb2 = makeCallbacks();
    asr.start(cb1);
    const first = FakeRecognition.instances[0];
    asr.start(cb2);
    const second = FakeRecognition.instances[1];

    expect(first.abortCalls).toBe(1);
    // 舊 session 已收尾
    expect(cb1.onEnd).toHaveBeenCalledTimes(1);
    // 舊實例的回調已被拆除，即使再吐結果也不會回調
    expect(first.onresult).toBeNull();
    expect(second.startCalls).toBe(1);
    second.onresult?.(resultEvent('新結果', true));
    expect(cb2.onResult).toHaveBeenCalledWith('新結果');
    expect(cb1.onResult).not.toHaveBeenCalled();
  });

  it('上層 callbacks 拋錯不會讓 ASR 層崩潰', () => {
    const { cb, recognition } = startNative();
    cb.onResult.mockImplementation(() => {
      throw new Error('consumer bug');
    });
    expect(() => recognition.onresult?.(resultEvent('你好', true))).not.toThrow();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });
});

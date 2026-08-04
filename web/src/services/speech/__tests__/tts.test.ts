/**
 * tts.test.ts — TTS 層單測（Vitest + jsdom）
 *
 * jsdom 沒有 speechSynthesis / SpeechSynthesisUtterance，正好驗證
 * 「無 API 環境」能力偵測與 fallback；播放行為透過 createTts({ getSynthesis })
 * 注入 FakeSynthesis 驗證。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PITCH,
  DEFAULT_RATE,
  TTS_LANG,
  createTts,
  isTtsSupported,
  speak,
  stopSpeaking,
} from '../tts';

/* ------------------------------------------------------------------ */
/* Fakes                                                                */
/* ------------------------------------------------------------------ */

type UtteranceHandler = ((event: { error?: string }) => void) | null;

class FakeUtterance {
  static created: FakeUtterance[] = [];

  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: UtteranceHandler = null;

  constructor(text: string) {
    this.text = text;
    FakeUtterance.created.push(this);
  }
}

interface FakeVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

function voice(name: string, lang: string): FakeVoice {
  return { name, lang, voiceURI: name, localService: true, default: false };
}

class FakeSynthesis extends EventTarget {
  private voicesList: FakeVoice[] = [];
  spoken: FakeUtterance[] = [];
  cancelCalls = 0;

  getVoices(): FakeVoice[] {
    return this.voicesList;
  }

  setVoices(voices: FakeVoice[]): void {
    this.voicesList = voices;
  }

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
  }

  cancel(): void {
    this.cancelCalls += 1;
  }

  pause(): void {
    /* no-op */
  }

  resume(): void {
    /* no-op */
  }
}

function installUtteranceCtor(): void {
  globalThis.SpeechSynthesisUtterance =
    FakeUtterance as unknown as typeof SpeechSynthesisUtterance;
}

beforeEach(() => {
  FakeUtterance.created = [];
  installUtteranceCtor();
});

afterEach(() => {
  // jsdom 原生沒有 SpeechSynthesisUtterance，直接移除測試用替身
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
});

/* ------------------------------------------------------------------ */
/* 能力偵測與 fallback                                                  */
/* ------------------------------------------------------------------ */

describe('能力偵測與 fallback', () => {
  it('無 speechSynthesis 環境回傳 false 且不拋錯', () => {
    expect(() => isTtsSupported()).not.toThrow();
    expect(isTtsSupported()).toBe(false);
    expect(createTts({ getSynthesis: () => undefined }).isSupported()).toBe(false);
  });

  it('不支援環境 speak 不拋錯：回傳 false、onError 帶 unsupported、不建立語句', () => {
    const tts = createTts({ getSynthesis: () => undefined });
    const onError = vi.fn();
    expect(() => tts.speak('你好', { onError })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('unsupported');
    expect(FakeUtterance.created).toHaveLength(0);
  });

  it('空白字串直接回傳 false，不接觸 speechSynthesis', () => {
    const synth = new FakeSynthesis();
    const tts = createTts({ getSynthesis: () => synth as unknown as SpeechSynthesis });
    expect(tts.speak('   ')).toBe(false);
    expect(synth.spoken).toHaveLength(0);
    expect(synth.cancelCalls).toBe(0);
  });

  it('沒有語句播放時 stop 為 no-op，不拋錯', () => {
    expect(() => stopSpeaking()).not.toThrow();
    const tts = createTts({ getSynthesis: () => undefined });
    expect(() => tts.stop()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* speak / stop 對 speechSynthesis mock 的調用                          */
/* ------------------------------------------------------------------ */

describe('speak / stop 行為', () => {
  function setup(voices: FakeVoice[] = []) {
    const synth = new FakeSynthesis();
    synth.setVoices(voices);
    const tts = createTts({ getSynthesis: () => synth as unknown as SpeechSynthesis });
    return { synth, tts };
  }

  it('speak 以 zh-HK、rate≈0.8、pitch 正常排入語句', () => {
    const { synth, tts } = setup([voice('Google 粵語', 'zh-HK')]);
    const onStart = vi.fn();
    expect(tts.speak('早晨，記得食藥', { onStart })).toBe(true);
    expect(synth.spoken).toHaveLength(1);
    const u = synth.spoken[0];
    expect(u.text).toBe('早晨，記得食藥');
    expect(u.lang).toBe(TTS_LANG);
    expect(u.rate).toBeCloseTo(DEFAULT_RATE); // ≈ 0.8
    expect(u.pitch).toBe(DEFAULT_PITCH);
    expect(u.volume).toBe(1);
    // 事件回調正常觸發
    u.onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('cancel-on-new：新語句到來先 cancel 上一句再排入', () => {
    const { synth, tts } = setup([voice('Google 粵語', 'zh-HK')]);
    tts.speak('第一句');
    expect(synth.cancelCalls).toBe(1);
    tts.speak('第二句');
    expect(synth.cancelCalls).toBe(2);
    expect(synth.spoken.map((u) => u.text)).toEqual(['第一句', '第二句']);
  });

  it('被新句取代的舊句事件一律靜默（不上報 onEnd / onError）', () => {
    const { synth, tts } = setup();
    const onError1 = vi.fn();
    const onEnd1 = vi.fn();
    tts.speak('舊句', { onError: onError1, onEnd: onEnd1 });
    const oldUtterance = synth.spoken[0];

    const onError2 = vi.fn();
    tts.speak('新句', { onError: onError2 });

    // Chrome 取消舊句時會補發 interrupted / canceled
    oldUtterance.onerror?.({ error: 'interrupted' });
    oldUtterance.onerror?.({ error: 'canceled' });
    oldUtterance.onend?.();
    expect(onError1).not.toHaveBeenCalled();
    expect(onEnd1).not.toHaveBeenCalled();
    expect(onError2).not.toHaveBeenCalled();
  });

  it('stop() 呼叫 speechSynthesis.cancel，並忽略舊句後續事件', () => {
    const { synth, tts } = setup();
    const onEnd = vi.fn();
    tts.speak('一句', { onEnd });
    const u = synth.spoken[0];
    tts.stop();
    expect(synth.cancelCalls).toBe(2); // speak 前一次 + stop 一次
    u.onend?.();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('語句自身出錯時上報 synthesis-error', () => {
    const { synth, tts } = setup();
    const onError = vi.fn();
    tts.speak('一句', { onError });
    const u = synth.spoken[0];
    u.onerror?.({ error: 'synthesis-failed' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('synthesis-error');
    // interrupted / canceled 不上報
    onError.mockClear();
    tts.speak('再一句', { onError });
    const u2 = synth.spoken[1];
    u2.onerror?.({ error: 'interrupted' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('synth.speak 拋錯時回傳 false 並上報，不崩潰', () => {
    const synth = new FakeSynthesis();
    synth.speak = () => {
      throw new Error('speak boom');
    };
    const tts = createTts({ getSynthesis: () => synth as unknown as SpeechSynthesis });
    const onError = vi.fn();
    expect(() => tts.speak('一句', { onError })).not.toThrow();
    expect(onError.mock.calls[0][0].code).toBe('synthesis-error');
  });
});

/* ------------------------------------------------------------------ */
/* 語音選擇與 voiceschanged 非同步載入                                   */
/* ------------------------------------------------------------------ */

describe('語音選擇（zh-HK 優先）與 voiceschanged', () => {
  function setup(voices: FakeVoice[] = []) {
    const synth = new FakeSynthesis();
    synth.setVoices(voices);
    const tts = createTts({ getSynthesis: () => synth as unknown as SpeechSynthesis });
    return { synth, tts };
  }

  it('同時存在多個中文語音時優先選 zh-HK', () => {
    const zhHK = voice('Sinji', 'zh-HK');
    const { synth, tts } = setup([
      voice('English', 'en-US'),
      voice('Tingting', 'zh-CN'),
      zhHK,
      voice('Meijia', 'zh-TW'),
    ]);
    tts.speak('你好');
    expect(synth.spoken[0].voice).toBe(zhHK);
  });

  it('無 zh-HK 時退而選 yue（粵語）／zh-Hant／其他 zh', () => {
    const yue = voice('Cantonese', 'yue-HK');
    const s1 = setup([voice('English', 'en-US'), yue]);
    s1.tts.speak('你好');
    expect(s1.synth.spoken[0].voice).toBe(yue);

    const hant = voice('Hant', 'zh-Hant-TW');
    const s2 = setup([voice('English', 'en-US'), hant]);
    s2.tts.speak('你好');
    expect(s2.synth.spoken[0].voice).toBe(hant);

    const zhCN = voice('Tingting', 'zh-CN');
    const s3 = setup([zhCN]);
    s3.tts.speak('你好');
    expect(s3.synth.spoken[0].voice).toBe(zhCN);
  });

  it('完全沒有中文語音時不指定 voice，僅設定 lang 讓引擎自選', () => {
    const { synth, tts } = setup([voice('English', 'en-US')]);
    tts.speak('你好');
    expect(synth.spoken[0].voice).toBeNull();
    expect(synth.spoken[0].lang).toBe('zh-HK');
  });

  it('voices 非同步載入：首次為空先播，voiceschanged 後下一句選中 zh-HK', () => {
    const { synth, tts } = setup([]); // 首次 getVoices() 為空
    tts.speak('第一句');
    expect(synth.spoken[0].voice).toBeNull();
    expect(synth.spoken[0].lang).toBe('zh-HK');

    // 模擬瀏覽器非同步載入完成
    const zhHK = voice('Sinji', 'zh-HK');
    synth.setVoices([zhHK]);
    synth.dispatchEvent(new Event('voiceschanged'));

    tts.speak('第二句');
    expect(synth.spoken[1].voice).toBe(zhHK);
  });
});

/* ------------------------------------------------------------------ */
/* 模組級便捷 API（預設實例接 window.speechSynthesis）                  */
/* ------------------------------------------------------------------ */

describe('模組級 API（speak / stopSpeaking / isTtsSupported）', () => {
  let synth: FakeSynthesis;

  beforeEach(() => {
    synth = new FakeSynthesis();
    synth.setVoices([voice('Sinji', 'zh-HK')]);
    Object.defineProperty(window, 'speechSynthesis', {
      value: synth,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'speechSynthesis');
  });

  it('speak / stopSpeaking 正確代理到 window.speechSynthesis', () => {
    expect(isTtsSupported()).toBe(true);
    expect(speak('記得飲水')).toBe(true);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].text).toBe('記得飲水');
    expect(synth.spoken[0].rate).toBeCloseTo(0.8);

    speak('第二句');
    expect(synth.cancelCalls).toBe(2);

    stopSpeaking();
    expect(synth.cancelCalls).toBe(3);
  });
});

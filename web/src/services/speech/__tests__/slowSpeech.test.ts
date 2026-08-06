/**
 * T6 慢速／斷句語音緩衝測試（mock ASR；fake timers）：
 *  - 8 秒靜音後先 finalize
 *  - 斷句聚合：唔會每段即刻送出
 *  - 重新講話會重設計時器
 *  - 絕對上限 35 秒
 *  - 冇 speech → gentle repeat（唔話識別失敗）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startSlowListening, type SlowSpeechState } from '../slowSpeech';

const { startListeningMock, stopListeningMock } = vi.hoisted(() => ({
  startListeningMock: vi.fn(),
  stopListeningMock: vi.fn(),
}));

vi.mock('../asr', () => ({
  startListening: startListeningMock,
  stopListening: stopListeningMock,
  isSpeechSupported: () => true,
}));

function capturedCallbacks(): {
  onInterim: (t: string) => void;
  onResult: (t: string) => void;
  onError: () => void;
  onEnd: () => void;
} {
  const callbacks = startListeningMock.mock.calls[0][0] as never;
  return callbacks as never;
}

describe('startSlowListening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startListeningMock.mockClear();
    stopListeningMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('斷句聚合：多個 chunk 合併，靜音 8 秒先 finalize', () => {
    const states: SlowSpeechState[] = [];
    const finals: string[] = [];
    startSlowListening({
      lang: 'zh-HK',
      onState: (s) => states.push(s),
      onFinal: (t) => finals.push(t),
    });
    const cb = capturedCallbacks();
    // 第一個 chunk
    cb.onResult('今日血壓');
    vi.advanceTimersByTime(3_000);
    cb.onResult('一百五十八');
    vi.advanceTimersByTime(3_000);
    cb.onResult('九十五');
    vi.advanceTimersByTime(3_000);
    cb.onResult('有啲頭暈');
    // 未到 8 秒 → 未 finalize
    vi.advanceTimersByTime(7_000);
    expect(finals).toHaveLength(0);
    // 靜音超過 8 秒 → stopListening → onEnd → 聚合送出
    vi.advanceTimersByTime(2_000);
    expect(stopListeningMock).toHaveBeenCalled();
    cb.onEnd();
    expect(finals).toEqual(['今日血壓一百五十八九十五有啲頭暈']);
    expect(states).toContain('pausing');
    expect(states).toContain('done');
  });

  it('冇任何 speech：準備期過後 gentle repeat（唔話識別失敗）', () => {
    const finals: string[] = [];
    const states: SlowSpeechState[] = [];
    startSlowListening({
      lang: 'zh-HK',
      onState: (s) => states.push(s),
      onFinal: (t) => finals.push(t),
    });
    vi.advanceTimersByTime(10_500); // 超過準備期 10s
    expect(stopListeningMock).toHaveBeenCalled();
    capturedCallbacks().onEnd();
    expect(finals).toEqual(['']);
    expect(states).toContain('repeat');
  });

  it('絕對上限 35 秒：無論有冇 speech 都會收尾', () => {
    const finals: string[] = [];
    startSlowListening({ lang: 'zh-HK', onFinal: (t) => finals.push(t) });
    const cb = capturedCallbacks();
    cb.onResult('持續講');
    vi.advanceTimersByTime(36_000);
    expect(stopListeningMock).toHaveBeenCalled();
    cb.onEnd();
    expect(finals).toEqual(['持續講']);
  });
});

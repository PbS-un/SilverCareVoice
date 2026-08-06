/**
 * T2 Elder AI Answer 自動朗讀「exactly once」測試（mock，不依賴真實
 * DeepSeek 或 browser voice）：
 *   - 新 answer → TTS 一次
 *   - rerender → 不重播
 *   - 歷史載入 → 不自動播放
 *   - 第二個新 answer → 再播一次
 *   - 不支援 speech synthesis（speak 回 false）→ 不 crash
 *   - manual playback 保留
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { demoReset } from '../../data/demoReset';
import { LanguageProvider } from '../../i18n';
import { setDemoSession } from '../../lib/demoAuth';
import ElderHome from '../ElderHome';
import type { AssistantResponse } from '../../core/assistant/AssistantService';

const { askMock, speakMock } = vi.hoisted(() => ({
  askMock: vi.fn(),
  speakMock: vi.fn(),
}));

vi.mock('../../core/assistant/AssistantService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/assistant/AssistantService')>();
  return {
    ...actual,
    ask: askMock,
  };
});

vi.mock('../../services/speech/tts', () => ({
  speak: (text: string, opts?: { onEnd?: () => void }) => {
    const ok = speakMock(text, opts);
    setTimeout(() => opts?.onEnd?.(), 0);
    return ok !== false;
  },
  stopSpeaking: vi.fn(),
  isTtsSupported: () => true,
}));

function makeResponse(convId: string, answer: string): AssistantResponse {
  return {
    answer,
    detailedAnswer: `詳細說明 ${convId}`,
    intent: 'symptom',
    riskLevel: 'normal',
    actions: [],
    // tableNameOf('Conversation') === 'conversations'（與真實 persisted 一致）
    persisted: { conversations: [`u-${convId}`, `a-${convId}`] },
    provider: 'local',
  };
}

function Harness() {
  return (
    <LanguageProvider>
      <MemoryRouter>
        <ElderHome />
      </MemoryRouter>
    </LanguageProvider>
  );
}

describe('ElderHome TTS autoplay exactly once', () => {
  beforeEach(async () => {
    askMock.mockReset();
    speakMock.mockReset();
    await demoReset();
    setDemoSession({
      accountCode: 'demo-001',
      accountId: 'seed-user-elder',
      elderId: 'seed-elder-01',
      caregiverId: 'seed-caregiver-01',
      elderName: '陳婆婆',
    });
  });

  it('新 answer 自動播放一次；rerender 不重播；第二個新 answer 再播一次；manual 保留', async () => {
    const { rerender } = render(<Harness />);
    const input = await screen.findByTestId('text-input', {}, { timeout: 10_000 });

    // 歷史載入：未送出任何訊息前不自動播放
    expect(speakMock).not.toHaveBeenCalled();

    // 第一條新 answer → TTS 一次（語言 zh-HK）
    askMock.mockResolvedValueOnce(makeResponse('1', '第一條回答'));
    fireEvent.change(input, { target: { value: '我今日有啲頭暈' } });
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(speakMock).toHaveBeenCalledTimes(1));
    expect(speakMock).toHaveBeenCalledWith('第一條回答', expect.objectContaining({ lang: 'zh-HK' }));

    // rerender → 不重播
    rerender(<Harness />);
    await waitFor(() => expect(screen.getByTestId('text-input')).toBeVisible());
    expect(speakMock).toHaveBeenCalledTimes(1);

    // 第二條新 answer → 再播一次
    askMock.mockResolvedValueOnce(makeResponse('2', '第二條回答'));
    fireEvent.change(screen.getByTestId('text-input'), { target: { value: '血壓 128/82' } });
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(speakMock).toHaveBeenCalledTimes(2));
    expect(speakMock).toHaveBeenLastCalledWith('第二條回答', expect.anything());

    // manual playback 保留：點「🔊 播放」再讀一次
    await waitFor(() => expect(screen.getByTestId('speak-button')).toBeVisible());
    fireEvent.click(screen.getByTestId('speak-button'));
    await waitFor(() => expect(speakMock).toHaveBeenCalledTimes(3));
  });

  it('speak 失敗（unsupported）時 answer 仍顯示、不 crash', async () => {
    render(<Harness />);
    const input = await screen.findByTestId('text-input', {}, { timeout: 10_000 });
    askMock.mockResolvedValueOnce(makeResponse('3', '離線回答'));
    // speak 模擬不支援（回 false，不觸發 onEnd）
    speakMock.mockImplementationOnce(() => false);
    fireEvent.change(input, { target: { value: '我胸口有啲唔舒服' } });
    fireEvent.click(screen.getByTestId('send-button'));
    await waitFor(() => expect(screen.getByTestId('answer-bubble')).toHaveTextContent('離線回答'));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * T1 四語言：字典、持久化、語音語言映射測試（不依賴真實 browser voice）。
 */
import { renderHook, act } from '@testing-library/react';

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LanguageProvider,
  readLocale,
  toSpeechLang,
  translate,
  useI18n,
  writeLocale,
  type AppLocale,
} from '../index';

describe('translate', () => {
  it('四種語言都有角色選擇標題', () => {
    expect(translate('zh-HK', 'role.title')).toBe('銀髮一句通');
    expect(translate('zh-CN', 'role.title')).toBe('银发一句通');
    expect(translate('pt', 'role.title')).toBe('SilverCare');
    expect(translate('en', 'role.title')).toBe('SilverCare');
  });

  it('支援 {var} 插值', () => {
    expect(translate('zh-HK', 'elder.todayAttention', { n: 3 })).toBe('有 3 件事要留意');
    expect(translate('en', 'elder.todayAttention', { n: 2 })).toBe('2 thing(s) to watch');
  });

  it('缺 key 回退 zh-HK，再缺回 key 本身', () => {
    expect(translate('en', 'app.loadingTitle')).toBe('SilverCare');
    expect(translate('pt', 'no-such-key')).toBe('no-such-key');
  });
});

describe('toSpeechLang', () => {
  it('映射 ASR／TTS 語音語言', () => {
    expect(toSpeechLang('zh-HK')).toBe('zh-HK');
    expect(toSpeechLang('zh-CN')).toBe('zh-CN');
    expect(toSpeechLang('pt')).toBe('pt-PT');
    expect(toSpeechLang('en')).toBe('en-US');
  });
});

describe('localStorage 持久化', () => {
  beforeEach(() => localStorage.clear());

  it('readLocale 預設 zh-HK；writeLocale 後保留', () => {
    expect(readLocale()).toBe(DEFAULT_LOCALE);
    writeLocale('en');
    expect(readLocale()).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('非法值回退預設', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });
});

describe('LanguageProvider + useI18n', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <LanguageProvider>{children}</LanguageProvider>
  );

  it('setLocale 即時切換並寫入 localStorage', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe(DEFAULT_LOCALE);
    act(() => result.current.setLocale('pt' as AppLocale));
    expect(result.current.locale).toBe('pt');
    expect(result.current.t('login.button')).toBe('Entrar');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt');
  });
});

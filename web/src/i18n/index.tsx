/**
 * i18n 核心（T1 四語言支援）
 *
 * 輕量、集中、可維護的翻譯機制：
 *  - AppLocale：zh-HK（繁體中文，預設）／zh-CN（简体中文）／pt（Português）／en（English）
 *  - localStorage 持久化（key: scv.locale.v1），refresh 保留
 *  - LanguageProvider + useI18n() hook（t(key, vars) 查表翻譯）
 *  - toSpeechLang(locale)：ASR／TTS 用語音語言代碼
 *
 * 不引入大型第三方 dependency；缺 key 時回退 zh-HK，再缺則回傳 key 本身。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DICTS } from './messages';

/** 支援的四種語言。 */
export type AppLocale = 'zh-HK' | 'zh-CN' | 'pt' | 'en';

export const LOCALES: readonly AppLocale[] = ['zh-HK', 'zh-CN', 'pt', 'en'];

export const DEFAULT_LOCALE: AppLocale = 'zh-HK';

/** localStorage key（不影響 IndexedDB / health data / sync token / demo data）。 */
export const LOCALE_STORAGE_KEY = 'scv.locale.v1';

/** 語言選項（原生語言名稱，長者易辨識）。 */
export const LOCALE_OPTIONS: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: 'zh-HK', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
];

/** 語音語言代碼（ASR／TTS）：繁中→zh-HK、简中→zh-CN、葡文→pt-PT、英文→en-US。 */
export function toSpeechLang(locale: AppLocale): string {
  switch (locale) {
    case 'zh-CN':
      return 'zh-CN';
    case 'pt':
      return 'pt-PT';
    case 'en':
      return 'en-US';
    case 'zh-HK':
    default:
      return 'zh-HK';
  }
}

/** 判斷是否合法語言代碼。 */
export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** 讀取當前語言（storage 不可用／非法值時回退預設，絕不拋錯）。 */
export function readLocale(): AppLocale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw && isAppLocale(raw)) return raw;
  } catch {
    /* 私隱模式等環境忽略 */
  }
  return DEFAULT_LOCALE;
}

/** 寫入語言設定（失敗時忽略，不影響流程）。 */
export function writeLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 寫入失敗不影響流程 */
  }
}

/** 翻譯查表：先查目前語言，缺 key 回退 zh-HK，再缺回 key 本身；支援 {var} 插值。 */
export function translate(
  locale: AppLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  let text = table[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

export interface I18nValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  /** 查表翻譯（缺 key 回退繁體中文）。 */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/** 語言 Provider：包住 App 全域，localStorage 持久化、即時切換。 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(readLocale);

  const setLocale = useCallback((next: AppLocale): void => {
    setLocaleState(next);
    writeLocale(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 讀取 i18n 值（必須在 LanguageProvider 內使用）。 */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n 必須在 LanguageProvider 內使用');
  return value;
}

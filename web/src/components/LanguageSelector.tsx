/**
 * 語言選擇器（T1.1）：四語言即時切換，localStorage 持久化。
 * compact 版用於頁頭（細圓角按鈕列）；預設為較大的長者友善按鈕列。
 */
import { LOCALE_OPTIONS, useI18n } from '../i18n';

export default function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();

  if (compact) {
    return (
      <select
        data-testid="language-selector"
        aria-label="Language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        className="min-h-10 rounded-lg border-2 border-[var(--sc-line)] bg-white px-2 text-base font-bold text-[var(--sc-ink)] outline-none focus:border-[var(--sc-idle)]"
      >
        {LOCALE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div
      data-testid="language-selector"
      role="group"
      aria-label="Language"
      className="flex flex-wrap gap-2"
    >
      {LOCALE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          data-testid={`lang-${o.value}`}
          aria-pressed={locale === o.value}
          onClick={() => setLocale(o.value)}
          className={`min-h-11 rounded-full border-2 px-4 text-lg font-bold transition-colors ${
            locale === o.value
              ? 'border-[var(--sc-idle)] bg-[var(--sc-idle)] text-white'
              : 'border-[var(--sc-line)] bg-white text-[var(--sc-ink)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

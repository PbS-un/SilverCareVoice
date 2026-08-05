/**
 * 長者友善可搜尋下拉輸入框（藥物／地點共用）。
 *
 * - 輸入即時過濾（rankMatches 分級匹配），最多顯示 8 項。
 * - 自由輸入永遠允許：onChange 同步每一次輸入值。
 * - 零匹配且提供 onCreate 時，顯示「＋ 新增『<輸入文字>』」選項行。
 * - 大觸控目標（選項 ≥48px / min-h-12）、沿用長者字體 class。
 * - 基本 ARIA combobox 模式（role/aria-expanded/aria-activedescendant）。
 */
import { useMemo, useState } from 'react';

import { rankMatches } from '../lib/textMatch';

/** 單一候選項。 */
export interface ComboboxOption {
  /** 選取時回傳的識別值。 */
  value: string;
  /** 顯示主文字（也作為匹配目標）。 */
  label: string;
  /** 選填副文字（如藥物劑量／地址）。 */
  sublabel?: string;
}

export interface SearchableComboboxProps {
  /** 候選列表。 */
  options: ComboboxOption[];
  /** 目前輸入框文字（受控）。 */
  value: string;
  /** 每次輸入變更（自由輸入永遠允許）。 */
  onChange: (text: string) => void;
  /** 選取既有選項時回傳其 value。 */
  onSelect: (value: string) => void;
  /** 輸入框 placeholder。 */
  placeholder?: string;
  /** data-testid 前綴（input/listbox/option/create 共用）。 */
  testIdPrefix: string;
  /** 提供後啟用「新增」行；零匹配時顯示。 */
  onCreate?: (text: string) => void;
  /** 自訂新增行文字，預設「＋ 新增『<輸入文字>』」。 */
  createLabel?: (text: string) => string;
}

/** 下拉一次最多顯示的選項數。 */
const MAX_VISIBLE = 8;

export default function SearchableCombobox({
  options,
  value,
  onChange,
  onSelect,
  placeholder,
  testIdPrefix,
  onCreate,
  createLabel,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const query = value.trim();

  // 過濾：空白查詢顯示全部；否則走 rankMatches 分級匹配
  const visible = useMemo<ComboboxOption[]>(() => {
    if (!query) return options.slice(0, MAX_VISIBLE);
    return rankMatches(query, options, (o) => o.label)
      .slice(0, MAX_VISIBLE)
      .map((r) => r.item);
  }, [query, options]);

  const showCreate = Boolean(onCreate) && query.length > 0 && visible.length === 0;
  const total = visible.length + (showCreate ? 1 : 0);

  const listboxId = `${testIdPrefix}-listbox`;
  const createText = createLabel ? createLabel(query) : `＋ 新增『${query}』`;

  const clampIndex = (i: number): number =>
    total === 0 ? 0 : Math.max(0, Math.min(i, total - 1));

  const selectOption = (opt: ComboboxOption): void => {
    onSelect(opt.value);
    setOpen(false);
  };

  const selectCreate = (): void => {
    onCreate?.(query);
    setOpen(false);
  };

  const pickActive = (): void => {
    if (activeIndex < visible.length) {
      selectOption(visible[activeIndex]);
    } else if (showCreate) {
      selectCreate();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => clampIndex(i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => clampIndex(i - 1));
    } else if (e.key === 'Enter') {
      if (open && total > 0) {
        e.preventDefault();
        pickActive();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && total > 0
            ? activeIndex < visible.length
              ? `${testIdPrefix}-option-${activeIndex}`
              : `${testIdPrefix}-create`
            : undefined
        }
        data-testid={`${testIdPrefix}-input`}
        className="text-elder-body w-full min-h-14 rounded-2xl border-2 border-[var(--sc-line)] bg-[var(--sc-card)] px-4 py-3 text-[var(--sc-ink)] placeholder:text-[var(--sc-muted)] focus:border-[var(--sc-idle)] focus:outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />

      {open && total > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          data-testid={listboxId}
          // preventDefault 保留輸入框焦點，避免 onBlur 先關閉
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-[var(--sc-line)] bg-[var(--sc-card)] py-1 shadow-lg"
        >
          {visible.map((opt, i) => (
            <li
              key={opt.value}
              id={`${testIdPrefix}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-testid={`${testIdPrefix}-option-${i}`}
              className={`flex min-h-12 w-full cursor-pointer flex-col justify-center break-words px-4 py-2 text-left ${
                i === activeIndex ? 'bg-[var(--sc-idle-soft)]' : 'bg-transparent'
              } hover:bg-[var(--sc-idle-soft)]`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => selectOption(opt)}
            >
              <span className="text-elder-body font-bold text-[var(--sc-ink)]">{opt.label}</span>
              {opt.sublabel && (
                <span className="text-base text-[var(--sc-ink-soft)]">{opt.sublabel}</span>
              )}
            </li>
          ))}
          {showCreate && (
            <li
              id={`${testIdPrefix}-create`}
              role="option"
              aria-selected={activeIndex >= visible.length}
              data-testid={`${testIdPrefix}-create`}
              className={`flex min-h-12 w-full cursor-pointer flex-col justify-center break-words px-4 py-2 text-left ${
                activeIndex >= visible.length ? 'bg-[var(--sc-idle-soft)]' : 'bg-transparent'
              } hover:bg-[var(--sc-idle-soft)]`}
              onMouseEnter={() => setActiveIndex(visible.length)}
              onClick={selectCreate}
            >
              <span className="text-elder-body font-bold text-[var(--sc-idle-deep)]">
                {createText}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

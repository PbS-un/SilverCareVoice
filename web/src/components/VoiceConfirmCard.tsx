/**
 * 語音「講一句直接完成」執行門控 UI 卡片（T16）。
 *
 * 三種卡片都在對話流內渲染（唔係小 dialog）：
 *  1. VoiceConfirmCard  — 大字「✓ 聽到：」確認卡（覆診／新藥），
 *     [確認記錄] 大綠掣 + [改一改] 次級掣。
 *  2. MedCandidatesCard — 候選藥物選擇卡：每個候選一個超大掣（≥56px）+「都唔係」。
 *  3. ContactCards      — 家人聯絡卡：有電話時巨型「📞 打俾XX」tel 連結
 *     （僅點擊撥號，絕不自動撥）+「通知佢我唔舒服」掣（走 notifyFamily）。
 */
import { useState } from 'react';

import type { ContactCardItem, MedCandidate } from '../core/assistant/AssistantService';

/* ==================== 確認卡 ==================== */

export interface VoiceConfirmCardProps {
  /** 摘要行（例：8月13日（星期三），15:00，去鏡湖醫院）。 */
  summary: string;
  /** 大綠掣回調（執行寫入）。 */
  onConfirm: () => void;
  /** 次級掣回調（開表單修改）。 */
  onEdit: () => void;
  busy?: boolean;
  /** 標題，預設「✓ 聽到：」。 */
  title?: string;
  confirmLabel?: string;
  editLabel?: string;
}

export function VoiceConfirmCard({
  summary,
  onConfirm,
  onEdit,
  busy,
  title = '✓ 聽到：',
  confirmLabel = '確認記錄',
  editLabel = '改一改',
}: VoiceConfirmCardProps): JSX.Element {
  return (
    <div
      data-testid="voice-confirm-card"
      className="card-elder mb-4 border-l-8 border-l-[var(--sc-ok)]"
      aria-label="確認記錄卡"
    >
      <p className="text-2xl font-black text-[var(--sc-ok)]">{title}</p>
      <p data-testid="voice-confirm-summary" className="mt-2 text-elder-body-lg font-bold leading-relaxed">
        {summary}
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <button
          type="button"
          data-testid="voice-confirm-yes"
          className="btn-elder btn-ok w-full !min-h-16 text-2xl"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '記低緊……' : confirmLabel}
        </button>
        <button
          type="button"
          data-testid="voice-confirm-edit"
          className="btn-elder btn-ghost w-full !min-h-14 text-xl"
          onClick={onEdit}
          disabled={busy}
        >
          {editLabel}
        </button>
      </div>
    </div>
  );
}

/* ==================== 候選藥物選擇卡 ==================== */

export interface MedCandidatesCardProps {
  candidates: MedCandidate[];
  /** 揀咗某個候選。 */
  onSelect: (candidate: MedCandidate) => void;
  /** 「都唔係」。 */
  onNone: () => void;
  busy?: boolean;
}

export function MedCandidatesCard({
  candidates,
  onSelect,
  onNone,
  busy,
}: MedCandidatesCardProps): JSX.Element {
  return (
    <div
      data-testid="med-candidate-card"
      className="card-elder mb-4 border-l-8 border-l-[var(--sc-thinking)]"
      aria-label="揀藥卡"
    >
      <p className="text-2xl font-black text-[var(--sc-ink)]">你講嘅係邊一種藥？</p>
      <div className="mt-3 flex flex-col gap-3">
        {candidates.map((c, i) => (
          <button
            key={c.id}
            type="button"
            data-testid={`med-candidate-${i}`}
            className="btn-elder btn-primary w-full !min-h-14 text-2xl"
            onClick={() => onSelect(c)}
            disabled={busy}
          >
            {c.name}
            {c.dosage ? <span className="ml-2 text-lg opacity-80">（{c.dosage}）</span> : null}
          </button>
        ))}
        <button
          type="button"
          data-testid="med-candidate-none"
          className="btn-elder btn-ghost w-full !min-h-14 text-xl"
          onClick={onNone}
          disabled={busy}
        >
          都唔係
        </button>
      </div>
    </div>
  );
}

/* ==================== 家人聯絡卡 ==================== */

export interface ContactCardsProps {
  items: ContactCardItem[];
  /** 「通知佢我唔舒服」→ notifyFamily（由父層執行）。 */
  onNotify: (item: ContactCardItem) => Promise<void> | void;
}

export function ContactCards({ items, onNotify }: ContactCardsProps): JSX.Element {
  const [busyId, setBusyId] = useState('');

  return (
    <div data-testid="contact-card" className="mb-4 flex flex-col gap-3" aria-label="家人聯絡卡">
      {items.map((c) => (
        <div key={c.id} className="card-elder !mb-0">
          <p className="text-elder-body-lg font-bold">
            {c.name}
            {c.relation ? <span className="ml-2 text-xl text-[var(--sc-ink-soft)]">（{c.relation}）</span> : null}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                data-testid={`contact-call-${c.id}`}
                className="btn-elder btn-primary w-full !min-h-16 text-2xl"
              >
                📞 打俾{c.name}
              </a>
            )}
            <button
              type="button"
              data-testid={`contact-notify-${c.id}`}
              className="btn-elder btn-ghost w-full !min-h-14 text-xl"
              disabled={busyId === c.id}
              onClick={() => {
                setBusyId(c.id);
                void Promise.resolve(onNotify(c)).finally(() => setBusyId(''));
              }}
            >
              {busyId === c.id ? '通知緊……' : '通知佢我唔舒服'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

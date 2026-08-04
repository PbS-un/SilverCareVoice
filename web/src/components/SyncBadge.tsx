/**
 * 同步狀態指示器：小圓點 + 文字。
 * 探測結果由 SyncedProvider 持有；此元件定期重讀，絕不阻塞 UI。
 */
import { useEffect, useState } from 'react';

import { enableSync } from '../data/DataProvider';

export default function SyncBadge() {
  const [synced, setSynced] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const check = (): void => {
      enableSync()
        .then((mode) => {
          if (live) setSynced(mode === 'sync');
        })
        .catch(() => {
          if (live) setSynced(false);
        });
    };
    check();
    const timer = window.setInterval(check, 20_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span
      data-testid="sync-status"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-white/80 px-2.5 py-1 text-sm text-[var(--sc-ink-soft)]"
      aria-live="polite"
    >
      <span
        aria-hidden
        className={`status-dot ${synced === true ? 'status-ok' : 'status-muted'}`}
      />
      {synced === true ? '已連接同步伺服器' : '離線模式'}
    </span>
  );
}

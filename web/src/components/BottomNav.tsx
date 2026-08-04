/**
 * 底部導航列（固定底欄）：老人端／家屬端各一組 + 切換角色入口。
 */
import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  testId?: string;
}

interface BottomNavProps {
  items: NavItem[];
}

export default function BottomNav({ items }: BottomNavProps) {
  return (
    <nav
      aria-label="底部導航"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-[var(--sc-line)] bg-white/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to !== '/'}
              data-testid={item.testId}
              aria-label={item.label}
              className={({ isActive }) =>
                `flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-lg font-bold transition-colors ${
                  isActive ? 'text-[var(--sc-idle-deep)]' : 'text-[var(--sc-muted)]'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const ELDER_NAV_ITEMS: NavItem[] = [
  { to: '/elder', label: '主頁', testId: 'nav-elder-home' },
  { to: '/elder/health', label: '我的記錄', testId: 'nav-elder-health' },
  { to: '/', label: '切換', testId: 'nav-switch' },
];

export const FAMILY_NAV_ITEMS: NavItem[] = [
  { to: '/family', label: '今天', testId: 'nav-family-home' },
  { to: '/family/health', label: '趨勢', testId: 'nav-family-health' },
  { to: '/family/alerts', label: '提醒', testId: 'nav-family-alerts' },
  { to: '/family/report', label: '週報', testId: 'nav-family-report' },
  { to: '/', label: '切換', testId: 'nav-switch' },
];

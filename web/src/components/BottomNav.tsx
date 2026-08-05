/**
 * 底部導航列（固定底欄）：老人端／家屬端各一組 + 切換角色入口。
 */
import { NavLink } from 'react-router-dom';
import { useI18n } from '../i18n';

interface NavItem {
  to: string;
  label: string;
  testId?: string;
}

interface BottomNavProps {
  items: NavItem[];
}

export default function BottomNav({ items }: BottomNavProps) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('nav.bar')}
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
              aria-label={t(item.label)}
              className={({ isActive }) =>
                `flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-lg font-bold transition-colors ${
                  isActive ? 'text-[var(--sc-idle-deep)]' : 'text-[var(--sc-muted)]'
                }`
              }
            >
              {t(item.label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const ELDER_NAV_ITEMS: NavItem[] = [
  { to: '/elder', label: 'nav.home', testId: 'nav-elder-home' },
  { to: '/elder/health', label: 'nav.records', testId: 'nav-elder-health' },
  { to: '/', label: 'nav.switch', testId: 'nav-switch' },
];

export const FAMILY_NAV_ITEMS: NavItem[] = [
  { to: '/family', label: 'nav.today', testId: 'nav-family-home' },
  { to: '/family/health', label: 'nav.trends', testId: 'nav-family-health' },
  { to: '/family/alerts', label: 'nav.alerts', testId: 'nav-family-alerts' },
  { to: '/family/report', label: 'nav.report', testId: 'nav-family-report' },
  { to: '/', label: 'nav.switch', testId: 'nav-switch' },
];

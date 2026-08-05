/**
 * 路由保護（T3.5）：未登入直接訪問受保護路由 → 跳去 /login。
 * sessionStorage 記錄 demoAuthenticated；refresh 同 session 保持登入。
 * /print-brief 屬公開例外（PDF 生成需要直接訪問），由 App.tsx 決定包唔包。
 */
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { isDemoAuthenticated } from '../lib/demoAuth';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!isDemoAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

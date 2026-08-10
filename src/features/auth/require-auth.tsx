import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useIsLoggedIn } from '@/features/users/hooks';
import { useSessionRefresh } from '@/features/auth/use-session-refresh';
import { Loader2 } from 'lucide-react';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn, isChecking } = useIsLoggedIn(); // one cached GET /iam/me
  const location = useLocation();

  // Renews ahead of expiry for as long as the authenticated area is mounted.
  useSessionRefresh();

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking session…</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

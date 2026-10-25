import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ME_KEY, useIsLoggedIn } from '@/features/users/hooks';
import { useSessionRefresh } from '@/features/auth/use-session-refresh';
import { onSessionEnded } from '@/state/auth-store';
import { Loader2 } from 'lucide-react';

/** What RequireAuth hands /login in the history state when it sends the visitor there. */
export interface LoginRedirectState {
  from?: string;
  /** The session was signed in and ended under the user — IAM refused to renew it. */
  sessionEnded?: boolean;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn, isChecking } = useIsLoggedIn(); // one cached GET /iam/me
  const location = useLocation();
  const qc = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);

  // Renews ahead of expiry for as long as the authenticated area is mounted.
  useSessionRefresh();

  // IAM refused the refresh token, whichever request asked for the renewal: drop the cached
  // user and the redirect below takes over. Going by /iam/me instead would keep the user in
  // while the access token lives — it answers 200 until then, renewable or not. The in-flight
  // read is cancelled first so it cannot land afterwards and sign them back in.
  useEffect(
    () =>
      onSessionEnded(() => {
        if (!qc.getQueryData(ME_KEY)) return; // never signed in on this page: nothing to end
        setSessionEnded(true);
        void qc.cancelQueries({ queryKey: ME_KEY }).then(() => qc.setQueryData(ME_KEY, null));
      }),
    [qc],
  );

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking session…</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    const state: LoginRedirectState = { from: location.pathname, sessionEnded };
    return <Navigate to="/login" replace state={state} />;
  }

  return <>{children}</>;
}

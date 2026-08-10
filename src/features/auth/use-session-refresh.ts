import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, FALLBACK_LIFETIME_MS, REFRESH_MARGIN_MS } from '@/state/auth-store';
import { ME_KEY, useIsLoggedIn } from '@/features/users/hooks';

/**
 * Keeps a signed-in session alive.
 *
 * The 401-retry in blocks-client is the safety net, not the strategy: on its own,
 * the first request after the access token expires always pays a failed round-trip,
 * and a background query can surface that as a flash of "signed out". This renews
 * ahead of expiry instead.
 *
 * Two triggers, because a timer alone is not enough — browsers throttle timers in
 * background tabs, so a tab left open overnight wakes up with a dead token and a
 * timer that never fired.
 *
 *   1. A timer, aimed a minute before expiry.
 *   2. Tab focus / visibility, when the token is already near expiry.
 *
 * Mounted once, inside the authenticated area.
 */
export function useSessionRefresh() {
  const { isLoggedIn } = useIsLoggedIn();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isLoggedIn) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const { refreshSession, needsRefresh } = useAuthStore.getState();

    async function refreshNow() {
      try {
        await refreshSession();
      } catch {
        // The session is genuinely gone. Re-reading /iam/me flips the guard to
        // signed-out and routes to /login — no need to duplicate that here.
        await qc.invalidateQueries({ queryKey: ME_KEY });
      }
    }

    /** Re-arm from whatever the store now knows about expiry. */
    function schedule() {
      if (cancelled) return;
      const { expiresAt } = useAuthStore.getState();
      const delay = expiresAt
        ? Math.max(expiresAt - REFRESH_MARGIN_MS - Date.now(), 1_000)
        : FALLBACK_LIFETIME_MS - REFRESH_MARGIN_MS;

      timer = setTimeout(async () => {
        await refreshNow();
        schedule();
      }, delay);
    }

    async function onWake() {
      if (document.visibilityState !== 'visible') return;
      if (!needsRefresh()) return;
      clearTimeout(timer);
      await refreshNow();
      schedule();
    }

    schedule();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [isLoggedIn, qc]);
}

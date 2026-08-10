import { create } from 'zustand';
import { BLOCKS, IAM_BASE } from '@/lib/env';

/**
 * Session renewal for the cookie-backed model.
 *
 * The browser holds NO access or refresh token — both live in HttpOnly cookies, set by
 * the login endpoints and rotated on every renewal. So this store carries no secret; it
 * exists to expose one de-duplicated `refreshSession()`.
 *
 * De-duplication is not an optimisation here. IAM rotates the refresh token on each use
 * and runs reuse detection on the old one (`HandlePotentialRefreshTokenReuseAsync`), so
 * two renewals racing on the same cookie can look like token theft and invalidate the
 * whole session. Every caller shares one in-flight request.
 *
 * Endpoint: POST /iam/v4/auth/refresh with `{}`. The body's `refresh_token` is optional
 * and IAM falls back to the cookie when it is absent — which is the only option here,
 * since JS cannot read an HttpOnly cookie.
 */

/** Renewed a minute before expiry, so a request never rides an almost-dead token. */
const REFRESH_MARGIN_MS = 60_000;
/** Used when IAM does not report `expires_in`. Access tokens are short (~5 min). */
const FALLBACK_LIFETIME_MS = 5 * 60_000;

interface RefreshResponse {
  expires_in?: number;
  access_token?: string;
}

interface AuthState {
  /** When the session was last renewed, or null if not yet this page load. */
  lastRefreshedAt: number | null;
  /** Epoch ms the current access token is expected to die, when IAM tells us. */
  expiresAt: number | null;
  /** Renew the session (rotates the cookies). Concurrent callers share one request. */
  refreshSession: () => Promise<void>;
  /** True when the token is close enough to expiry to be worth renewing early. */
  needsRefresh: () => boolean;
  /** Drop local auth state — called on logout, even when the network call failed. */
  clear: () => void;
}

let inFlight: Promise<RefreshResponse> | null = null;

async function renew(): Promise<RefreshResponse> {
  const res = await fetch(`${IAM_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include', // sends the refresh cookie, and applies the rotated one
    headers: {
      'x-blocks-key': BLOCKS.projectKey,
      'Content-Type': 'application/json',
    },
    // Empty body on purpose: the refresh token is HttpOnly, so IAM reads the cookie.
    body: '{}',
  });

  if (!res.ok) throw new Error(`session refresh failed: ${res.status}`);
  return (await res.json().catch(() => ({}))) as RefreshResponse;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  lastRefreshedAt: null,
  expiresAt: null,

  refreshSession: async () => {
    inFlight ??= renew()
      .then((result) => {
        set({
          lastRefreshedAt: Date.now(),
          expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
        });
        return result;
      })
      .finally(() => {
        inFlight = null;
      });

    await inFlight;
  },

  needsRefresh: () => {
    const { expiresAt, lastRefreshedAt } = get();
    if (expiresAt) return Date.now() >= expiresAt - REFRESH_MARGIN_MS;
    // No expiry reported — fall back to elapsed time since the last renewal.
    if (lastRefreshedAt) return Date.now() - lastRefreshedAt >= FALLBACK_LIFETIME_MS - REFRESH_MARGIN_MS;
    return false;
  },

  clear: () => set({ lastRefreshedAt: null, expiresAt: null }),
}));

export { REFRESH_MARGIN_MS, FALLBACK_LIFETIME_MS };

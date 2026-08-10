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

/**
 * "This browser plausibly has a session."
 *
 * The session cookies are HttpOnly, so JS cannot ask whether one exists. Without a hint,
 * every anonymous page load would answer a 401 by firing a pointless `/auth/refresh`, and
 * a dead session would re-attempt renewal on each subsequent call. This flag is that hint —
 * it holds no secret and grants nothing; the cookies remain the only real credential.
 *
 * It lives in localStorage so it survives a reload, which is precisely the case the 401
 * retry has to cover: the tab returns with a long-dead access token and a live refresh one.
 */
const SESSION_MARKER = 'blocks.session';

const storage = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_MARKER) === '1';
    } catch {
      return false; // private mode / storage disabled
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(SESSION_MARKER, '1');
      else localStorage.removeItem(SESSION_MARKER);
    } catch {
      /* nothing to do — refresh still works, just without the shortcut */
    }
  },
};

/** Call after any successful sign-in, so 401s become renewable from here on. */
export const markSignedIn = () => storage.set(true);
/** Call on sign-out, or when renewal is definitively refused. */
export const clearSignedIn = () => storage.set(false);
/** Whether a renewal attempt is worth making at all. */
export const maybeSignedIn = () => storage.get();

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
    // `refresh_token` is nullable on RefreshRequest, so an empty object is a valid body.
    body: '{}',
  });

  if (!res.ok) {
    // 401/403 means the refresh cookie is gone or already used — the session is over and
    // no later call should keep asking. Anything else (network, 5xx) may be transient, so
    // leave the marker alone and let the next 401 try again.
    if (res.status === 401 || res.status === 403) clearSignedIn();
    throw new Error(`session refresh failed: ${res.status}`);
  }

  markSignedIn();
  return (await res.json().catch(() => ({}))) as RefreshResponse;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  lastRefreshedAt: null,
  expiresAt: null,

  refreshSession: async () => {
    // Nothing to renew: never signed in, signed out, or renewal already refused. Failing
    // here (rather than calling) is what turns a 401 into "logged out" for anonymous
    // visitors without a wasted round-trip.
    if (!maybeSignedIn()) throw new Error('no session to refresh');

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

  clear: () => {
    clearSignedIn();
    set({ lastRefreshedAt: null, expiresAt: null });
  },
}));

export { REFRESH_MARGIN_MS, FALLBACK_LIFETIME_MS };

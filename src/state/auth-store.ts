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
 * Endpoint: see REFRESH_ENDPOINT below. Either variant sends no token in the body —
 * the refresh token is an HttpOnly cookie, so IAM reads it off the request and JS has
 * nothing to hand over.
 */

/** Renewed a minute before expiry, so a request never rides an almost-dead token. */
const REFRESH_MARGIN_MS = 60_000;
/** Used when IAM does not report `expires_in`. Access tokens are short (~5 min). */
const FALLBACK_LIFETIME_MS = 5 * 60_000;

/**
 * "This browser plausibly has a session."
 *
 * The session cookies are HttpOnly, so JS cannot ask whether one exists. Without a hint,
 * every anonymous page load would answer a 401 by firing a pointless renewal call, and
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

/**
 * TEMPORARY: renewal goes through the OIDC token endpoint instead of `auth/refresh`.
 *
 * `auth/refresh` is the intended endpoint and the one the rest of this file is written
 * around; it is bypassed here only until it behaves on the current deployment. The two
 * differ in wire format, not in meaning:
 *
 *   auth/refresh      POST {IAM_BASE}/auth/refresh   JSON `{}`
 *   oidc/token        POST {IAM_BASE}/oidc/token     form `grant_type=refresh_token`
 *
 * e.g. https://blocksapi.selisesme.com/iam/v4/oidc/token — the host comes from
 * VITE_BLOCKS_API_URL, so each environment renews against its own API.
 *
 * Flip this to 'auth-refresh' to put it back — nothing else has to change.
 */
const REFRESH_ENDPOINT: 'oidc-token' | 'auth-refresh' = 'oidc-token';

/**
 * The request the chosen endpoint expects.
 *
 * Neither body carries a token: the refresh cookie is HttpOnly and travels on the
 * request itself. `client_id` goes out only when the project configured one — the OIDC
 * token endpoint accepts the cookie-backed grant without it, and an empty value reads
 * as a claim about a client that does not exist.
 */
function refreshRequest(): { url: string; headers: Record<string, string>; body: string } {
  if (REFRESH_ENDPOINT === 'oidc-token') {
    const form = new URLSearchParams({ grant_type: 'refresh_token' });
    if (BLOCKS.oidcClientId) form.set('client_id', BLOCKS.oidcClientId);

    return {
      url: `${IAM_BASE}/oidc/token`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    };
  }

  return {
    url: `${IAM_BASE}/auth/refresh`,
    headers: { 'Content-Type': 'application/json' },
    // `refresh_token` is nullable on RefreshRequest, so an empty object is a valid body.
    body: '{}',
  };
}

/**
 * Whether a refused renewal is final — the cookie is gone, spent, or rejected — as
 * opposed to a transient network or server fault worth another try later.
 *
 * The two endpoints say it differently, which is the whole reason this is a function:
 * `auth/refresh` answers 401/403, while the OIDC token endpoint follows OAuth and
 * answers **400 `invalid_grant`**. Reading a 400 as transient would leave the marker on
 * and re-attempt renewal on every later 401 for a session that is definitively over.
 */
function renewalRefused(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;

  const error = (body as { error?: unknown } | null)?.error;
  return error === 'invalid_grant' || error === 'invalid_request';
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
  const { url, headers, body } = refreshRequest();

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include', // sends the refresh cookie, and applies the rotated one
    headers: { 'x-blocks-key': BLOCKS.projectKey, ...headers },
    body,
  });

  const payload = (await res.json().catch(() => null)) as RefreshResponse | null;

  if (!res.ok) {
    // A refused renewal means the session is over and no later call should keep asking.
    // Anything else (network, 5xx) may be transient, so leave the marker alone and let
    // the next 401 try again.
    if (renewalRefused(res.status, payload)) clearSignedIn();
    throw new Error(`session refresh failed: ${res.status}`);
  }

  markSignedIn();
  return payload ?? {};
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

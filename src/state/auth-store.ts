import { create } from 'zustand';
import { BLOCKS, IAM_BASE } from '@/lib/env';
import { trackedFetch } from '@/lib/tracked-fetch';

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
 * Neither endpoint is sent a token: the refresh token is an HttpOnly cookie, so IAM reads
 * it off the request and JS has nothing to hand over.
 */

/** Renewed a minute before expiry, so a request never rides an almost-dead token. */
const REFRESH_MARGIN_MS = 60_000;
/** Used when IAM does not report `expires_in`. Access tokens are short (~5 min). */
const FALLBACK_LIFETIME_MS = 5 * 60_000;

interface RefreshResponse {
  expires_in?: number;
  access_token?: string;
}

/**
 * Renewal goes to the OIDC token endpoint, with `auth/refresh` behind it:
 *
 *   oidc/token     POST {IAM_BASE}/oidc/token     form `grant_type=refresh_token&client_id=…`
 *   auth/refresh   POST {IAM_BASE}/auth/refresh   JSON `{}`
 *
 * e.g. https://blocksapi.selisesme.com/iam/v4/oidc/token — the host comes from
 * VITE_BLOCKS_API_URL, so each environment renews against its own API.
 *
 * oidc/token is the only one that can renew an impersonated session, but it renews only a
 * session that belongs to an OIDC client — one started through the hosted login. The in-app
 * forms (password, MFA, social) start a session with no client, which oidc/token refuses
 * as 401 `invalid_client` however fresh the cookie is. auth/refresh takes either kind.
 */
type Endpoint = 'oidc-token' | 'auth-refresh';

/** `client_id` is mandatory on oidc/token — without one configured there is no point asking. */
const FIRST_CHOICE: Endpoint = BLOCKS.oidcClientId ? 'oidc-token' : 'auth-refresh';

/**
 * Where renewal goes first. Moves to auth/refresh once that has renewed a session oidc/token
 * refused: a session keeps its client (or its lack of one) for life, so asking oidc/token
 * again would only repeat the refusal. Reset on sign-out, since the next session may differ.
 */
let preferred: Endpoint = FIRST_CHOICE;

function refreshRequest(endpoint: Endpoint): { url: string; headers: Record<string, string>; body: string } {
  if (endpoint === 'oidc-token') {
    const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: BLOCKS.oidcClientId });

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
 * Whether oidc/token turned the request away over the client rather than the token — the
 * case auth/refresh may still renew. IAM answers all of these before it touches the
 * refresh token, so the cookie is unspent and safe to present a second time:
 *
 *   401 invalid_client    the session has no OIDC client (started by an in-app form)
 *   400 invalid_client    VITE_BLOCKS_OIDC_CLIENT_ID is not a client of this project
 *   400 invalid_request   the client does not read the refresh cookie
 *
 * `invalid_grant` is not here: that is the token itself being dead, and auth/refresh would
 * only say so again.
 */
function refusedForClient(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 401) return false;

  const error = (body as { error?: unknown } | null)?.error;
  return error === 'invalid_client' || error === 'invalid_request';
}

/**
 * IAM refused the refresh token itself: expired, revoked (e.g. "Sign out" on this device
 * from another session), or a user who may no longer sign in. Nothing can renew it, so the
 * session is over and the visitor has to sign in again.
 *
 *   oidc/token     400 invalid_grant            "Refresh token is invalid or expired"
 *   auth/refresh   400 invalid_refresh_token    (also clears the session cookies)
 *
 * Refusals over the client never get this far — renew() retries those on auth/refresh, and
 * only that answer counts. A network failure or a 5xx is not this either: it says nothing
 * about the token, and the next attempt may well succeed.
 */
export class SessionEndedError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`session ended: refresh refused with ${status}`);
    this.name = 'SessionEndedError';
  }
}

const refusedToken = (status: number) => status === 400 || status === 401 || status === 403;

type SessionEndedListener = () => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

/**
 * Called once per refused renewal, however many requests were waiting on it. Returns the
 * unsubscribe function, so it drops straight into a useEffect.
 */
export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

async function post(endpoint: Endpoint): Promise<{ res: Response; payload: RefreshResponse | null }> {
  const { url, headers, body } = refreshRequest(endpoint);

  const res = await trackedFetch(url, {
    method: 'POST',
    credentials: 'include', // sends the refresh cookie, and applies the rotated one
    headers: { 'x-blocks-key': BLOCKS.projectKey, ...headers },
    body,
  });

  const payload = (await res.json().catch(() => null)) as RefreshResponse | null;
  return { res, payload };
}

interface AuthState {
  /** When the session was last renewed, or null if not yet this page load. */
  lastRefreshedAt: number | null;
  /** Epoch ms the current access token is expected to die, when IAM tells us. */
  expiresAt: number | null;
  /**
   * Renew the session (rotates the cookies). Concurrent callers share one request. Rejects
   * with SessionEndedError when IAM refuses the refresh token, after telling onSessionEnded.
   */
  refreshSession: () => Promise<void>;
  /** True when the token is close enough to expiry to be worth renewing early. */
  needsRefresh: () => boolean;
  /** Drop local auth state — called on logout, even when the network call failed. */
  clear: () => void;
}

let inFlight: Promise<RefreshResponse> | null = null;

async function renew(): Promise<RefreshResponse> {
  let { res, payload } = await post(preferred);

  if (!res.ok && preferred === 'oidc-token' && refusedForClient(res.status, payload)) {
    ({ res, payload } = await post('auth-refresh'));
    if (res.ok) preferred = 'auth-refresh';
  }

  if (!res.ok) {
    if (refusedToken(res.status)) throw new SessionEndedError(res.status, payload);
    throw new Error(`session refresh failed: ${res.status}`);
  }
  return payload ?? {};
}

/**
 * Renewals are serialised across tabs as well. Every tab shares one cookie jar, so two tabs
 * renewing in the same instant present the same refresh token; the one that loses can be
 * told invalid_grant and would sign itself out of a session the other tab just renewed.
 * Behind a Web Lock the second tab waits, then renews with the rotated cookie.
 */
async function renewAcrossTabs(): Promise<RefreshResponse> {
  if (!navigator.locks) return renew();
  return navigator.locks.request('blocks-session-renewal', renew);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  lastRefreshedAt: null,
  expiresAt: null,

  refreshSession: async () => {
    // No client-side pre-check: the cookies are HttpOnly, so asking IAM is the only way to
    // learn whether a 401 is renewable. A visitor who never signed in costs a refused call.
    inFlight ??= renewAcrossTabs()
      .then((result) => {
        set({
          lastRefreshedAt: Date.now(),
          expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
        });
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof SessionEndedError) {
          get().clear();
          sessionEndedListeners.forEach((listener) => listener());
        }
        throw error;
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
    preferred = FIRST_CHOICE;
    set({ lastRefreshedAt: null, expiresAt: null });
  },
}));

export { REFRESH_MARGIN_MS, FALLBACK_LIFETIME_MS };

import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE, withoutPort } from '@/lib/env';
import { markSignedIn } from '@/state/auth-store';

/**
 * Embedded ("implicit") login — the app owns the login screen.
 *
 * Unlike the hosted flow in ./sso.ts, nothing here bounces the user through
 * iam.seliseblocks.com. The password form posts straight to IAM, and the social
 * providers redirect back to *this* app's /callback route.
 *
 *   password:  POST auth/login                       → session cookie
 *   social:    GET  auth/social/initiate  → provider → POST auth/social/callback → session cookie
 *
 * Both endpoints set the same HttpOnly cookie the hosted flow sets, so everything
 * downstream (/iam/me, the 401 refresh-and-retry) is unchanged.
 */

/**
 * Where the providers send the browser back.
 *
 * Taken from the live origin with the port dropped, so dev and production both
 * send the single registered URI — https://<app-domain>/callback. Same rule as
 * the hosted flow's redirectUri: the providers match it byte-for-byte, and only
 * the port-less form is registered.
 */
export const SOCIAL_REDIRECT_URI = withoutPort(`${window.location.origin}/callback`);

export interface SsoProvider {
  /** Canonical name: "google", "microsoft", … */
  provider: string;
  displayName: string;
  icon: string;
  /** The provider's own OAuth client id — the lookup key for social/initiate. */
  clientId: string;
  /** Redirect URIs registered on the Blocks identity-provider record. */
  redirectUris: string[];
}

export interface LoginOptions {
  allowedGrantTypes: string[];
  ssoInfo: SsoProvider[] | null;
}

/** Which sign-in methods this project actually has switched on. */
export async function getLoginOptions(): Promise<LoginOptions> {
  const res = await blocksFetch<LoginOptions>(`${IAM_BASE}/auth/login-options`, { noRetry: true });
  return { allowedGrantTypes: res.allowedGrantTypes ?? [], ssoInfo: res.ssoInfo ?? [] };
}

/** Errors IAM returns as `{error, error_description}` with a non-2xx status. */
export interface AuthFailure {
  error?: string;
  error_description?: string;
  redirect_url?: string | null;
  /** True when the credentials were right but a second factor is still owed. */
  mfa_required?: boolean;
  /** Present when the account has MFA switched on — the handle for the second leg. */
  mfa_id?: string;
  /** Numeric in the payload (2 = email); the string form is tolerated as well. */
  mfa_type?: number | string;
  /** Human-readable channel list, e.g. "Email". */
  mfa_methods?: string;
}

/**
 * A second factor IAM is waiting on. Credentials were accepted; the session cookie
 * is NOT set yet and only appears once the code comes back verified.
 */
export interface MfaChallenge {
  /** Identifies this attempt. Single-use: a new sign-in mints a new one and a new code. */
  mfaId: string;
  /** 2 = email, as IAM numbers them. Null when the payload left it out. */
  type: number | null;
  /** Where the code went, in IAM's own words ("Email"). Empty when unreported. */
  methods: string;
}

export type LoginResult =
  | { status: 'signed-in' }
  | { status: 'mfa-required'; challenge: MfaChallenge };

/** Bodies arrive parsed, or as text when the response carried no JSON content type. */
function asPayload(body: unknown): AuthFailure | null {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as AuthFailure;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? (body as AuthFailure) : null;
}

/**
 * Reads an MFA challenge out of a login response, whichever way IAM framed it.
 *
 * The body is error-*shaped* (`error: "mfa_enabled"`) but it is not a failure — the
 * password was accepted and IAM is asking for the second leg. It currently arrives
 * with HTTP 200, which is why this is checked on the resolved value and not only in
 * a catch. `mfa_id` is what makes the answer actionable: without one there is nothing
 * to continue with, so it really is just an error.
 */
export function mfaChallenge(body: unknown): MfaChallenge | null {
  const payload = asPayload(body);
  if (!payload?.mfa_id) return null;
  if (!payload.mfa_required && payload.error !== 'mfa_enabled') return null;

  const type = Number(payload.mfa_type);
  return {
    mfaId: payload.mfa_id,
    type: Number.isFinite(type) ? type : null,
    methods: payload.mfa_methods ?? '',
  };
}

/**
 * Same read, for something thrown by `blocksFetch`. A rejected code comes back as a
 * plain `invalid_mfa_code` today, with the id still good for another attempt — this
 * is here so that a future IAM that *does* rotate the id on rejection updates the
 * caller's handle instead of stranding it on a retired one.
 */
export function mfaChallengeFromError(error: unknown): MfaChallenge | null {
  return error instanceof BlocksError ? mfaChallenge(error.body) : null;
}

/**
 * Username + password. Resolves either with the session cookie set, or with the MFA
 * challenge IAM wants answered first — see submitMfaCode for that second leg. The
 * caller re-reads /iam/me rather than trusting anything in this response body.
 *
 * `captchaCode` carries the answered challenge when the project configured one —
 * see features/auth/captcha.ts. Omitted rather than sent empty: IAM treats the field
 * being present as a claim that a challenge was solved, and rejects a blank one.
 * Without it a captcha-protected project answers `captcha_enabled`, which the login
 * page turns back into a challenge.
 */
export async function loginWithPassword(
  username: string,
  password: string,
  captchaCode?: string,
): Promise<LoginResult> {
  try {
    const res = await blocksFetch<unknown>(`${IAM_BASE}/auth/login`, {
      method: 'POST',
      body: { username, password, ...(captchaCode ? { captchaCode } : {}) },
      noRetry: true, // a 401 here means bad credentials, not an expired session
    });
    // An MFA account answers with a challenge, not a session. IAM sends it as a 200
    // with an error-shaped body, so it lands here rather than in the catch — which
    // stays anyway, so a 4xx framing of the same thing is not read as a failure.
    const challenge = mfaChallenge(res);
    if (challenge) return { status: 'mfa-required', challenge };
  } catch (error) {
    const challenge = mfaChallengeFromError(error);
    if (challenge) return { status: 'mfa-required', challenge };
    throw error;
  }

  // From now on a 401 is renewable rather than terminal — see state/auth-store.
  markSignedIn();
  return { status: 'signed-in' };
}

/**
 * Second leg: hand the emailed/authenticator code back and finish the sign-in.
 *
 * Same endpoint as the password leg — `mfa_id` is what tells IAM which half of the
 * flow this is, so no username or password is repeated. The hosted login page posts
 * the same thing to its own `/api/oidc/login`; this is the direct equivalent.
 *
 * All three of `mfa_id`, `mfa_code` and `mfa_type` are mandatory — leaving the type
 * out is a 400 `invalid_request`, not a defaulted 2. It is echoed straight back from
 * the challenge rather than assumed, so an account on some other factor still works.
 *
 * The tenant deliberately does NOT go in the body: `x-blocks-key` already carries it
 * on every call (see lib/blocks-client), and a second copy in the payload is one more
 * place for the two to disagree.
 */
export async function submitMfaCode(challenge: MfaChallenge, mfaCode: string): Promise<void> {
  await blocksFetch(`${IAM_BASE}/auth/login`, {
    method: 'POST',
    body: {
      mfa_id: challenge.mfaId,
      mfa_code: mfaCode,
      ...(challenge.type === null ? {} : { mfa_type: challenge.type }),
    },
    noRetry: true, // a 401 is a wrong code, not an expired session
  });
  markSignedIn();
}

/**
 * Step 1 of social login: swap the provider's client id for an authorization URL.
 * IAM caches the `state` server-side, so this cannot be built on the client.
 */
export async function startSocialLogin(provider: SsoProvider): Promise<never> {
  const query = new URLSearchParams({
    clientId: provider.clientId,
    redirectUri: SOCIAL_REDIRECT_URI,
  });

  const { authorizationUrl } = await blocksFetch<{ authorizationUrl?: string }>(
    `${IAM_BASE}/auth/social/initiate?${query}`,
    { noRetry: true },
  );

  if (!authorizationUrl) throw new Error('social/initiate returned no authorization URL');

  // Remember which provider we sent them to — the callback has to name it, and the
  // provider does not echo it back.
  sessionStorage.setItem(PROVIDER_KEY, provider.provider);

  window.location.assign(authorizationUrl);
  return new Promise<never>(() => {}); // navigation in flight; never resolves
}

const PROVIDER_KEY = 'blocks.sso.provider';

/** The provider the current round-trip was started with, if any. */
export const pendingProviderName = (): string | null => sessionStorage.getItem(PROVIDER_KEY);

/** Step 2: hand the provider's code back to IAM, which sets the session cookie. */
export async function finishSocialLogin(search: string): Promise<void> {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    const err = params.get('error_description') ?? params.get('error');
    throw new Error(err ?? 'The provider returned no authorization code.');
  }

  await blocksFetch(`${IAM_BASE}/auth/social/callback`, {
    method: 'POST',
    body: { code, state, provider: pendingProviderName() ?? undefined },
    noRetry: true,
  });

  // Only drop the marker once the session actually exists — the sign-up path
  // below still needs to know which provider vouched for this person.
  sessionStorage.removeItem(PROVIDER_KEY);
  markSignedIn();
}

/**
 * First-time sign-in for someone the project has never seen.
 *
 * IAM authenticates the identity but will not create the membership: an unknown
 * email comes back as `user_not_found`. This creates the account (active and
 * verified immediately, with the project's default roles) so the provider
 * round-trip can be replayed and the session established.
 *
 * Requires SSO sign-up to be enabled on the project, otherwise IAM answers
 * `signup_disabled`.
 */
export async function signUpWithSso(
  email: string,
  provider: string,
  profile: { firstName?: string; lastName?: string } = {},
): Promise<void> {
  // The provider's profile is only ever seen by IAM, and only on a callback that
  // resolves to an existing user — a rejected one carries just the email. So the
  // name has to be collected here or the account is created without one, and
  // nothing backfills it on later logins.
  await blocksFetch(`${IAM_BASE}/auth/signup`, {
    method: 'POST',
    body: {
      email,
      provider,
      isSsoSignup: true,
      firstName: profile.firstName?.trim() || undefined,
      lastName: profile.lastName?.trim() || undefined,
    },
    noRetry: true,
  });
}

/** Restart a provider round-trip knowing only the provider's name. */
export async function restartSocialLogin(providerName: string): Promise<never> {
  const { ssoInfo } = await getLoginOptions();
  const provider = (ssoInfo ?? []).find((p) => p.provider === providerName);
  if (!provider) throw new Error(`Provider "${providerName}" is no longer configured.`);
  return startSocialLogin(provider);
}

/**
 * IAM reports the unknown address as `"<email> does not exist"`. That string is
 * the only place the email surfaces, so the sign-up offer has to read it back out.
 */
export function unknownUserEmail(error: unknown): string | null {
  const body = error instanceof BlocksError ? error.body : null;
  const payload = body as { error?: string; error_description?: string } | null;
  if (payload?.error !== 'user_not_found') return null;

  const match = /[^\s]+@[^\s]+/.exec(payload.error_description ?? '');
  return match ? match[0] : null;
}

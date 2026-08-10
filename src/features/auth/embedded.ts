import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE, withoutPort } from '@/lib/env';

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
  /** Present when the account has MFA switched on. */
  mfa_id?: string;
  mfa_type?: string;
}

/**
 * Username + password. Resolves once the session cookie is set; the caller then
 * re-reads /iam/me rather than trusting anything in this response body.
 */
export async function loginWithPassword(username: string, password: string): Promise<void> {
  await blocksFetch(`${IAM_BASE}/auth/login`, {
    method: 'POST',
    body: { username, password },
    noRetry: true, // a 401 here means bad credentials, not an expired session
  });
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

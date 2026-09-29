import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

/**
 * One-click signup links — the implicit flow.
 *
 * An administrator generates a link for a named invitee through IAM's API. The invitee
 * opens it and ends up signed in here, with the roles the link froze at generation; they
 * never see a sign-up form and, in Passwordless mode, never choose a password.
 *
 * Like ./embedded.ts and unlike ./sso.ts, nothing bounces through a Blocks-hosted page:
 * this app owns the join screen. Two calls:
 *
 *   GET  iam/signup-links/context   → who the link is for, without spending it
 *   POST iam/signup-links/redeem    → spends it; what comes back depends on the mode
 *
 * The code is single-use and expires on the configuration's lifetime.
 */

const SIGNUP_LINKS = `${IAM_BASE}/iam/signup-links`;

export type CredentialMode = 'Passwordless' | 'PasswordRequired';

/** Which flow the configuration was authored in. Discriminates the redeem response. */
export type SignupLinkMode = 'Oidc' | 'Embedded';

export interface SignupLinkContext {
  valid: boolean;
  credentialMode?: CredentialMode;
  firstName?: string;
  /** e.g. "a•••@example.com" — enough to recognise, not enough to harvest. */
  maskedEmail?: string;
  applicationName?: string;
  mode?: SignupLinkMode;
}

/**
 * Exactly one of authorizeUrl / activationKey / loginUrl / mfaId is populated, or none
 * of them when an embedded redemption completed and the session cookie is already set.
 */
export interface RedeemSignupLinkResponse {
  mode?: SignupLinkMode;
  authorizeUrl?: string;
  activationKey?: string;
  activationKeyExpiresAtUtc?: string;
  credentialMode?: CredentialMode;
  loginUrl?: string;
  mfaId?: string;
  userMfa?: string;
  error?: string;
}

/**
 * Takes the code out of the URL fragment and clears it.
 *
 * IAM composes the link as `<join url>#link=<code>`. A fragment never reaches a server,
 * so the code stays out of access logs, proxy logs and `Referer` headers — and clearing
 * it keeps it out of this tab's history entry and anything the user might copy or share
 * from the address bar afterwards.
 *
 * Returns '' when there is no code, which the page renders as an invalid link.
 */
export function readLinkCode(): string {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return '';

  const code = new URLSearchParams(hash).get('link') ?? '';
  if (code) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return code;
}

/**
 * Who the link is for. Anonymous, and does **not** spend the code — so an expired or
 * already-used link can be reported without the page having consumed anything.
 *
 * `noRetry` because a 401 here means the link is bad, not that a session lapsed; the
 * refresh-and-replay in blocksFetch would be answering the wrong question.
 */
export function getSignupLinkContext(code: string): Promise<SignupLinkContext> {
  return blocksFetch<SignupLinkContext>(`${SIGNUP_LINKS}/context`, {
    headers: { 'X-Signup-Link-Code': code },
    noRetry: true,
  });
}

/** Spends the code. Single-use: a second call with the same code fails. */
export function redeemSignupLink(code: string): Promise<RedeemSignupLinkResponse> {
  return blocksFetch<RedeemSignupLinkResponse>(`${SIGNUP_LINKS}/redeem`, {
    method: 'POST',
    body: { code },
    noRetry: true,
  });
}

/**
 * Second leg when the invitee already had an account with MFA enabled. The original
 * code is spent by now; `mfaId` is what carries the redemption forward.
 */
export function completeSignupLinkMfa(
  mfaId: string,
  mfaCode: string,
): Promise<RedeemSignupLinkResponse> {
  return blocksFetch<RedeemSignupLinkResponse>(`${SIGNUP_LINKS}/redeem/mfa`, {
    method: 'POST',
    body: { mfaId, mfaCode },
    noRetry: true,
  });
}

/** What the join page should do next with a redeem response. */
export type RedeemOutcome =
  /** Embedded mode finished: the session cookie is set and the app is signed in. */
  | { kind: 'signed-in' }
  /** OIDC mode: follow this and the browser comes back to /login/callback. */
  | { kind: 'navigate'; url: string }
  /** PasswordRequired: the invitee sets a password on /activate before any session. */
  | { kind: 'activate'; activationKey: string }
  /** The invitee already had an account with MFA on. */
  | { kind: 'mfa'; mfaId: string; userMfa?: string }
  | { kind: 'error'; error: string };

/**
 * Reads the branch out of a redeem response.
 *
 * Order matters: `error` first because IAM can populate it alongside a mode, and the
 * embedded "signed in" case is last because it is the *absence* of every other field
 * rather than a field of its own.
 */
export function redeemOutcome(res: RedeemSignupLinkResponse): RedeemOutcome {
  if (res.error) return { kind: 'error', error: res.error };
  if (res.mfaId) return { kind: 'mfa', mfaId: res.mfaId, userMfa: res.userMfa };
  if (res.activationKey) return { kind: 'activate', activationKey: res.activationKey };
  if (res.authorizeUrl) return { kind: 'navigate', url: res.authorizeUrl };
  if (res.loginUrl) return { kind: 'navigate', url: res.loginUrl };
  if (res.mode === 'Embedded') return { kind: 'signed-in' };

  // An Oidc response with no authorizeUrl has nowhere to send the browser. Saying so
  // beats a blank screen that looks like the app hung.
  return { kind: 'error', error: 'invalid_link' };
}

/** IAM's redeem error codes, in the words the invitee should see. */
export function joinErrorMessage(error: string): string {
  switch (error) {
    case 'invalid_link':
      return 'This invitation link is not valid. Ask whoever invited you to send a new one.';
    case 'expired':
      return 'This invitation has expired. Ask whoever invited you to send a new one.';
    case 'revoked':
      return 'This invitation has been withdrawn. Get in touch with whoever invited you.';
    case 'exhausted':
      return 'This invitation has already been used.';
    case 'client_invalid':
    case 'provider_not_registered':
      // A misconfiguration on the project, not anything the invitee can act on.
      return 'This invitation cannot be completed because the application is not set up correctly. Let whoever invited you know.';
    default:
      return 'This invitation could not be completed. Ask whoever invited you to send a new one.';
  }
}

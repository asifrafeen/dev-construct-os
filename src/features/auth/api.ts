import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS, IAM_BASE } from '@/lib/env';
import { assertAccountOk, type AccountResponse } from './errors';

/**
 * Start password recovery. Always resolves for a well-formed address, whether or not
 * an account exists — IAM answers identically either way so the endpoint cannot be
 * used to discover who has an account. Do not "improve" this by reporting not-found.
 *
 * The emailed link's origin is derived from the Origin/Referer of *this* request when
 * the project has no fixed AccountActionBaseUrl, so it points back at whichever host
 * the user was on.
 */
export async function recoverAccount(email: string): Promise<void> {
  const res = await blocksFetch<AccountResponse>(`${IAM_BASE}/auth/recover`, {
    method: 'POST',
    body: { email },
    noRetry: true,
  });
  // A 200 here still carries `isSuccess: false` for validation failures.
  assertAccountOk(res);
}

export interface ResetPasswordInput {
  /** One-time code from the recovery email link. */
  code: string;
  password: string;
  /** Ends every other session — the safe default after a suspected compromise. */
  logoutFromAllDevices?: boolean;
}

/** Finish recovery: exchange the emailed code for a new password. */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const res = await blocksFetch<AccountResponse>(`${IAM_BASE}/auth/reset-password`, {
    method: 'POST',
    body: {
      code: input.code,
      password: input.password,
      logoutFromAllDevices: input.logoutFromAllDevices ?? true,
    },
    noRetry: true,
  });
  assertAccountOk(res);
}

/** Cookie/session logout — capital L, empty `{}` body. Revokes and clears the SSO cookies. */
export async function logout(): Promise<void> {
  await blocksFetch<unknown>(`${IAM_BASE}/auth/Logout`, {
    method: 'POST',
    body: {},
    headers: { accept: 'application/json' },
    noRetry: true, // refreshing a session we're tearing down is pointless
  });
}

export interface ActivateInput {
  /** Invitation token from /activate?code=… */
  code: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Invite-and-activate only — not part of SSO login. Already-activated users never
 * touch this. The invitation code is the credential, so there is no session here.
 */
export async function activate(input: ActivateInput): Promise<unknown> {
  const res = await fetch(`${IAM_BASE}/auth/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-blocks-key': BLOCKS.projectKey },
    body: JSON.stringify({
      captchaCode: '',
      mailPurpose: '',
      preventPostEvent: false,
      ...input,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`activation failed (${res.status}): ${detail || 'no response body'}`);
  }
  return res.json().catch(() => ({}));
}

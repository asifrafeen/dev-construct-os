import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';
import { authErrorMessage } from './errors';

/**
 * Self-service MFA enrolment — the other half of the login-time challenge in
 * ./embedded.ts. Everything here acts on *the caller's own* user: IAM takes the id
 * from the session, never from the body, and refuses a disable aimed at anyone else.
 *
 * Email enrolment is a two-call round trip, and the second call is the enrolment:
 *
 *   POST mfa/generate  { mfaType: 2 }                     → { mfaId }, code emailed
 *   POST mfa/verify    { mfaId, verificationCode, … }     → MFA is now on
 *
 * There is no "set the flag" step — `verify` is what flips mfaEnabled, userMfaType
 * and isMfaVerified on the user, so a code that never comes back leaves the account
 * exactly as it was. (IAM does expose PUT mfa/method, which turns Email on with no
 * code at all. It is deliberately not used: enrolling a channel without proving the
 * user can receive on it is how people lock themselves out.)
 */

const MFA = `${IAM_BASE}/mfa`;

/** IAM's UserMfaType enum. The login challenge reports the same numbers back. */
export const MFA_TYPE = {
  none: 0,
  totp: 1,
  email: 2,
  sms: 3,
  whatsApp: 4,
} as const;

export type MfaTypeValue = (typeof MFA_TYPE)[keyof typeof MFA_TYPE];

/** Emailed codes are 5 digits (11111–99999) and live for 5 minutes. */
export const EMAIL_CODE_LENGTH = 5;
export const EMAIL_CODE_TTL_MINUTES = 5;

/**
 * The project-wide MFA policy.
 *
 * Reading it needs `blocks-iam::iam::mfa-configs`, which an ordinary member does not
 * hold — so a 403 here is normal, not a fault, and the UI has to work without it.
 * `enabled` is the one that actually gates enrolment: with MFA off for the project,
 * generate answers `mfa_not_enable` whatever the user does.
 */
export interface MfaPolicy {
  enabled: boolean;
  /** UserMfaType values the project offers, e.g. [1, 2]. */
  allowedMethods: number[];
  requireMfaForAllUsers: boolean;
  mfaRequiredRoles: string[] | null;
  mfaExemptRoles: string[] | null;
  allowUserOptOut: boolean;
  allowBackupCodes: boolean;
  backupCodesCount: number;
}

export const getMfaPolicy = (): Promise<MfaPolicy> => blocksFetch<MfaPolicy>(`${MFA}/config`);

/**
 * Step 1: have IAM mail a fresh code. The returned `mfaId` is the handle for it and
 * expires with it — nothing is written to the user's account at this point.
 */
export async function startEmailMfaEnrolment(): Promise<string> {
  const { mfaId } = await blocksFetch<{ mfaId?: string }>(`${MFA}/generate`, {
    method: 'POST',
    body: { mfaType: MFA_TYPE.email },
  });
  if (!mfaId) throw new Error('IAM accepted the request but returned no mfaId.');
  return mfaId;
}

/**
 * Send another code for a challenge already in flight. The request carries the mfaId
 * we already hold, and the caller goes on using that same id afterwards — matching
 * how the Blocks-hosted login page drives this endpoint.
 *
 * The response does contain an id, and it is deliberately ignored. Worth knowing what
 * that costs: `ResendOtpAsync` looks our id up only to read the user off it, then
 * hands to `GenerateOTPAsync`, which stores a *new* code under a *new* GUID. Our entry
 * is left alone rather than deleted, so the code from the first mail keeps working for
 * its five minutes — but the freshly mailed one is bound to the id we threw away, and
 * verifying it against ours reads the older code and answers invalid_two_factor_code.
 *
 * Used by both MFA screens. Note that IAM guards this with `[Authorize]`: on the login
 * step, where the session cookie does not exist until a code is accepted, it answers
 * 401 with `www-authenticate: Bearer`. The caller needs an answer ready for that.
 */
export async function resendMfaCode(mfaId: string): Promise<void> {
  await blocksFetch<{ mfaId?: string }>(`${MFA}/resend`, {
    method: 'POST',
    body: { mfaId },
  });
}

/**
 * Step 2: prove the code arrived, which is what enrols the user.
 *
 * `isFromTokenCall: false` is the whole point of the flag — true marks the check the
 * login flow does, which validates the code and changes nothing. False is the
 * enrolling call, so it must not be dropped or "tidied up".
 */
export async function confirmEmailMfaEnrolment(mfaId: string, code: string): Promise<void> {
  await blocksFetch<{ valid?: boolean }>(`${MFA}/verify`, {
    method: 'POST',
    body: {
      mfaId,
      verificationCode: code,
      authType: MFA_TYPE.email,
      isFromTokenCall: false,
    },
  });
  // A wrong or expired code is a 400 and has already thrown; reaching here means
  // IAM answered `valid: true` and the user record is updated.
}

/**
 * Turn MFA off for the signed-in user. No body — IAM reads the id from the session
 * and rejects anything else, so there is no way to disable someone else's from here.
 */
export const disableMfa = (): Promise<unknown> =>
  blocksFetch<unknown>(`${MFA}/disable`, { method: 'POST', body: {} });

/**
 * The MFA endpoints answer `{ errors: { <code>: <message> } }`, and the codes are not
 * all prose — the OTP service puts a bare code under `message`, so printing the value
 * raw would show "invalid_two_factor_code" to a person.
 */
const MFA_ERROR_HELP: Record<string, string> = {
  invalid_two_factor_code: 'That code is not correct. Check the email and try again.',
  invalid_two_factor_id: `That code has expired — they are only good for ${EMAIL_CODE_TTL_MINUTES} minutes. Send a new one.`,
  mfa_not_enable:
    'Two-step verification is switched off for this project. An administrator has to enable it first.',
  empty_user_id: 'IAM could not tell which account this is. Sign in again and retry.',
  invalid_user_id: 'You can only change two-step verification on your own account.',
  email_not_verified:
    'Your email address is not verified yet, so it cannot be used for verification codes.',
  phonenumber_not_exist: 'That account has no phone number on file.',
};

function bodyOf(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof BlocksError)) return null;
  const body = error.body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
}

/**
 * The bare error code, for callers that have to branch on it rather than print it —
 * a resend that fails on `invalid_two_factor_id` needs different advice from one
 * that fails on a wrong code.
 */
export function mfaErrorCode(error: unknown): string {
  const body = bodyOf(error);
  const errors = body?.errors;

  if (errors && typeof errors === 'object') {
    for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
      if (key in MFA_ERROR_HELP) return key;
      if (String(value) in MFA_ERROR_HELP) return String(value);
    }
  }
  return typeof body?.error === 'string' ? body.error : '';
}

/** Readable sentence for anything these endpoints throw. */
export function mfaErrorMessage(error: unknown): string {
  const body = bodyOf(error);
  const errors = body?.errors;

  if (errors && typeof errors === 'object') {
    // Both halves can carry the code: `{ mfa_not_enable: "…" }` names it in the key,
    // `{ message: "invalid_two_factor_code" }` in the value.
    for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
      const help = MFA_ERROR_HELP[key] ?? MFA_ERROR_HELP[String(value)];
      if (help) return help;
    }
    const first = Object.values(errors as Record<string, unknown>).find(Boolean);
    if (first) return String(first);
  }

  const named = typeof body?.error === 'string' ? MFA_ERROR_HELP[body.error] : undefined;
  if (named) return named;

  return authErrorMessage(error);
}

import { BlocksError } from '@/lib/blocks-client';

/**
 * Blocks/OAuth error codes turned into something a person can act on. The raw
 * codes are unreadable in a UI and the fix for each is different, so they get
 * spelled out. Shared by the hosted flow (./sso.ts) and the embedded one
 * (./embedded.ts) — both surface the same IAM error vocabulary.
 */
const ERROR_HELP: Record<string, string> = {
  invalid_username_password: 'That email and password combination is not correct.',
  account_locked:
    'This account is temporarily locked after too many failed attempts. Wait a few minutes and try again.',
  user_inactive_or_not_verified:
    'That account is not active yet. Check your inbox for the activation email.',
  mfa_enabled: 'This account needs a verification code. Enter the one that was just sent to you.',
  mfa_enrollment_required: 'This account has to finish multi-factor enrolment before signing in.',
  invalid_mfa_code: 'That verification code is not correct.',
  mfa_session_expired: 'The verification step timed out. Start signing in again.',
  captcha_enabled: 'This project requires a CAPTCHA. Complete the challenge below and try again.',
  captcha_invalid: 'That CAPTCHA response was rejected. Solve the new challenge and try again.',
  // IAM matches federated logins to existing users by email and does not
  // auto-provision — the account has to be invited and activated first.
  user_not_found:
    'There is no account with that email address on this project. An administrator has to invite it first.',
  provider_not_found: 'That sign-in provider is not configured on this project.',
  provider_inactive: 'That sign-in provider is switched off on this project.',
  invalid_provider_type: 'That provider is not a social identity provider.',
  state_data_not_found:
    'This sign-in link has already been used or has expired. Start again from the sign-in page.',
  state_data_invalid: 'This sign-in link is malformed. Start again from the sign-in page.',
  code_require: 'The identity provider returned no authorization code.',
  state_require: 'The identity provider returned no state value.',
  access_denied: 'You cancelled the sign-in, or the identity provider refused it.',
  invalid_client:
    'This app is not registered correctly with Blocks — the OIDC client id or redirect URI does not match.',
  redirect_uri_mismatch:
    'The redirect URI this app sent does not match the one registered on the provider.',
};

/**
 * Turns an IAM error payload into a readable sentence. Bodies arrive either as
 * JSON (`{error, error_description}`), as an already-parsed object, or as text.
 */
export function describeAuthError(status: number, body: unknown): string {
  let code = '';
  let description = '';

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { error?: string; error_description?: string };
      code = parsed.error ?? '';
      description = parsed.error_description ?? '';
    } catch {
      description = body;
    }
  } else if (body && typeof body === 'object') {
    const parsed = body as { error?: string; error_description?: string };
    code = parsed.error ?? '';
    description = parsed.error_description ?? '';
  }

  // The provider does not always populate the code field — some errors name the
  // condition only inside the description.
  const haystack = `${code} ${description}`.toLowerCase();
  const matched = Object.keys(ERROR_HELP).find(
    (key) => haystack.includes(key) || haystack.includes(key.replace(/_/g, ' ')),
  );

  if (matched) return ERROR_HELP[matched];
  if (haystack.includes('did not provide any email')) {
    return 'The identity provider did not release an email address, so Blocks cannot match you to an account.';
  }
  if (haystack.includes('not active')) {
    return 'That account exists but is deactivated. An administrator has to re-enable it.';
  }

  return description || code || `Sign-in failed (${status}).`;
}

/** Same treatment for anything thrown by `blocksFetch`. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof BlocksError) return describeAuthError(error.status, error.body);
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The bare `error` code, for the few cases where the caller has to *branch* rather
 * than just print — an expired MFA session has to send the user back to the password
 * form, where a wrong code only needs the message.
 */
export function authErrorCode(error: unknown): string {
  if (!(error instanceof BlocksError)) return '';
  const body = error.body;
  if (typeof body === 'string') {
    try {
      return (JSON.parse(body) as { error?: string }).error ?? '';
    } catch {
      return '';
    }
  }
  return body && typeof body === 'object' ? ((body as { error?: string }).error ?? '') : '';
}

/**
 * The account endpoints (recover, reset-password, activate, signup) do not use the
 * OAuth error shape. They answer `{isSuccess, errors: {Field: "message"}}` — and can
 * report failure with HTTP 200, so the status alone is not a verdict.
 */
export interface AccountResponse {
  isSuccess?: boolean;
  itemId?: string | null;
  errors?: Record<string, string> | null;
}

/** First field message, or null when the response is a success. */
export function accountErrorMessage(response: AccountResponse | undefined): string | null {
  if (response?.isSuccess) return null;
  const messages = Object.values(response?.errors ?? {}).filter(Boolean);
  return messages[0] ?? 'The request could not be completed. Please try again.';
}

/**
 * The same `{isSuccess, errors}` body, dug back out of a *thrown* request.
 *
 * recover and reset report failure with HTTP 200, so `accountErrorMessage` above sees
 * the body directly. Signup does not — it answers 400, which `blocksFetch` turns into
 * a BlocksError before any caller can look inside. Returns null when the error is not
 * account-shaped, so the caller can fall back to `authErrorMessage`.
 */
export function accountErrorFromError(error: unknown): string | null {
  if (!(error instanceof BlocksError)) return null;

  let body: unknown = error.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;

  const response = body as AccountResponse;
  if (!response.errors || typeof response.errors !== 'object') return null;
  return accountErrorMessage(response);
}

/** Throws with a readable message unless the account call actually succeeded. */
export function assertAccountOk(response: AccountResponse | undefined): void {
  const message = accountErrorMessage(response);
  if (message) throw new Error(message);
}

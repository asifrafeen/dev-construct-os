import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { BLOCKS, IAM_BASE } from '@/lib/env';

/**
 * CAPTCHA configuration, as the project publishes it.
 *
 * The whole thing is server-driven: a project turns CAPTCHA on by storing a
 * `captcha` secret (isEnable/provider/captchaKey/captchaSecret) and IAM echoes the
 * *public* half of it from `idp/oidc-ui-config`. Nothing is hard-coded here — a
 * project with CAPTCHA switched off answers with no `captcha` block at all, and the
 * forms then render without a challenge.
 *
 * Only the site key ever reaches the browser. The secret stays with IAM, which is
 * what actually verifies the code the widget produces.
 */

export interface CaptchaConfig {
  /** Public site key for the widget. Safe in the bundle — the secret is IAM-side. */
  key: string;
  /** "recaptcha" | "hcaptcha" — decides which widget script gets loaded. */
  provider: string;
  /** e.g. "EasyCaptchaGenerator". Reported for parity with IAM; no behaviour here. */
  generator?: string;
}

interface OidcUiConfig {
  captcha?: CaptchaConfig | null;
}

export const CAPTCHA_CONFIG_KEY = ['auth', 'captcha-config'] as const;

/**
 * Ask IAM whether this project wants a CAPTCHA, and with which key.
 *
 * `tenantId` is our own project key — the same value that rides on every call as
 * `x-blocks-key`. Resolves to null when the project has no CAPTCHA configured.
 */
export async function getCaptchaConfig(): Promise<CaptchaConfig | null> {
  const query = new URLSearchParams({ tenantId: BLOCKS.projectKey });
  const res = await blocksFetch<OidcUiConfig>(
    `${IAM_BASE}/idp/oidc-ui-config?${query}`,
    // Unauthenticated by design: this is read before anyone has a session.
    { noRetry: true, headers: { accept: 'application/json' } },
  );
  return res?.captcha?.key ? res.captcha : null;
}

/** The `{error, error_description, captcha_site_key}` shape IAM rejects with. */
interface CaptchaFailure {
  error?: string;
  error_description?: string;
  captcha_site_key?: string;
  captchaSiteKey?: string;
}

function failureBody(error: unknown): CaptchaFailure | null {
  if (!(error instanceof BlocksError)) return null;
  const body = error.body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as CaptchaFailure;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? (body as CaptchaFailure) : null;
}

/**
 * True when IAM turned the request down over the CAPTCHA rather than the
 * credentials — either it wants one we did not send (`captcha_enabled`) or the one
 * we sent did not verify (`captcha_invalid`).
 */
export function isCaptchaError(error: unknown): boolean {
  const code = failureBody(error)?.error ?? '';
  return code === 'captcha_enabled' || code === 'captcha_invalid';
}

/**
 * A CAPTCHA rejection can name the site key to use, which is how a project that
 * switched CAPTCHA on mid-session still gets a working widget without a reload.
 * It takes precedence over the cached oidc-ui-config answer.
 */
export function captchaSiteKeyFromError(error: unknown): string | null {
  const body = failureBody(error);
  const key = body?.captcha_site_key ?? body?.captchaSiteKey;
  return key ? String(key) : null;
}

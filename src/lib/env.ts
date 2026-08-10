/**
 * Client-safe Blocks configuration.
 *
 * Every value here ships in the bundle. The project key is a public identifier; the
 * impersonated project token (PTOK) and the account password are CLI-only and must
 * never reach this file.
 */

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const BLOCKS = {
  /** e.g. https://blocksapi.slsblx.com — must be same-site with the app domain. */
  apiUrl: trimSlash(import.meta.env.VITE_BLOCKS_API_URL ?? ''),
  /** Project tenant id, sent as `x-blocks-key` on every Blocks call. */
  projectKey: import.meta.env.VITE_BLOCKS_PROJECT_KEY ?? '',
  /** OIDC clientId of the project's blocks-oidc identity provider. */
  oidcClientId: import.meta.env.VITE_BLOCKS_OIDC_CLIENT_ID ?? '',
  /** Must match a registered redirectUri byte-for-byte. */
  redirectUri: import.meta.env.VITE_BLOCKS_REDIRECT_URI ?? '',
} as const;

/**
 * Same URL with any explicit port dropped (https://host:5173/x → https://host/x).
 * IAM rejects a redirectUri that carries a port, so the initiate call sends this form.
 */
export function withoutPort(url: string): string {
  try {
    const u = new URL(url);
    u.port = '';
    const out = u.toString();
    // URL always renders a bare origin with a trailing slash — don't invent one.
    return out.endsWith('/') && !url.endsWith('/') ? out.slice(0, -1) : out;
  } catch {
    return url;
  }
}

export const IAM_BASE = `${BLOCKS.apiUrl}/iam/v4`;
export const DATA_BASE = `${BLOCKS.apiUrl}/data/v4`;
export const LOCALIZATION_BASE = `${BLOCKS.apiUrl}/localization/v4`;

/** Config problems worth surfacing in the UI instead of failing as an opaque 400/401. */
export function configIssues(): string[] {
  const issues: string[] = [];
  if (!BLOCKS.apiUrl) issues.push('VITE_BLOCKS_API_URL is not set.');
  if (!BLOCKS.projectKey) issues.push('VITE_BLOCKS_PROJECT_KEY is not set.');
  if (!BLOCKS.oidcClientId)
    issues.push(
      'VITE_BLOCKS_OIDC_CLIENT_ID is not set — run `npm run blocks:configure-oidc` and paste the clientId into .env.',
    );
  if (!BLOCKS.redirectUri) issues.push('VITE_BLOCKS_REDIRECT_URI is not set.');

  if (BLOCKS.apiUrl && BLOCKS.redirectUri) {
    const registrable = (host: string) => host.split('.').slice(-2).join('.');
    try {
      const api = registrable(new URL(BLOCKS.apiUrl).hostname);
      const app = registrable(new URL(BLOCKS.redirectUri).hostname);
      if (api !== app) {
        issues.push(
          `VITE_BLOCKS_API_URL (${api}) is not same-site with the app domain (${app}) — ` +
            'the SSO session cookie will never be stored. Use https://blocksapi.' + app + '.',
        );
      }
    } catch {
      issues.push('VITE_BLOCKS_API_URL or VITE_BLOCKS_REDIRECT_URI is not a valid URL.');
    }
  }
  return issues;
}

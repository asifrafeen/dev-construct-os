import { BLOCKS, IAM_BASE, withoutPort } from '@/lib/env';
import { describeAuthError } from './errors';

/**
 * Hosted authorization-code SSO.
 *
 * Blocks owns the login screen and the whole PKCE dance — the app never handles a
 * username, a password, or a code_verifier. Two calls, one redirect:
 *
 *   startLogin()  → GET /idp/initiate → navigate to the returned authorize URL
 *   finishLogin() → GET /idp/callback → session cookie is set
 */

/** Step 1: ask IAM for the authorize URL. This is a fetch, NOT a navigation. */
export async function startLogin(): Promise<never> {
  if (!BLOCKS.oidcClientId) {
    throw new Error(
      'No OIDC client id configured. Run `npm run blocks:configure-oidc` and set VITE_BLOCKS_OIDC_CLIENT_ID.',
    );
  }

  const url =
    `${IAM_BASE}/idp/initiate` +
    `?x-blocks-key=${encodeURIComponent(BLOCKS.projectKey)}` +
    `&clientId=${encodeURIComponent(BLOCKS.oidcClientId)}` +
    // Port-less: IAM matches the registered redirectUri without the dev-server port.
    `&redirectUri=${encodeURIComponent(withoutPort(BLOCKS.redirectUri))}`;

  // x-blocks-key must be sent in BOTH the query string and the header — omitting
  // either makes initiate fail.
  const res = await fetch(url, { headers: { 'x-blocks-key': BLOCKS.projectKey } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`initiate failed (${res.status}): ${detail || 'no response body'}`);
  }

  const { redirect_uri: redirectUri } = (await res.json()) as { redirect_uri?: string };
  if (!redirectUri) throw new Error('initiate returned no redirect_uri');

  // Step 2: hand the browser off to the Blocks-hosted login.
  window.location.assign(redirectUri);
  return new Promise<never>(() => {}); // navigation in flight; never resolves
}

/** Step 4: run on the callback route. This is what sets the session cookie. */
export async function finishLogin(search: string): Promise<void> {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    // A provider-side rejection (consent declined, misconfigured client) comes
    // back as error params instead of a code.
    const err = params.get('error');
    const description = params.get('error_description');
    if (err || description) throw new Error(describeAuthError(400, `${err ?? ''} ${description ?? ''}`));
    throw new Error('The sign-in response was missing its code and state. Start again from the sign-in page.');
  }

  const res = await fetch(
    `${IAM_BASE}/idp/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { credentials: 'include', headers: { 'x-blocks-key': BLOCKS.projectKey } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(describeAuthError(res.status, detail));
  }
}

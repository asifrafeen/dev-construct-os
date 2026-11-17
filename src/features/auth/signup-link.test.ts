import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import {
  type RedeemOutcome,
  type RedeemSignupLinkResponse,
  authenticateSignupLink,
  completeSignupLinkMfa,
  getSignupLinkContext,
  joinErrorMessage,
  readLinkCode,
  redeemOutcome,
  redeemSignupLink,
} from './signup-link';

const SIGNUP_LINKS = 'https://blocksapi.example.com/iam/v4/iam/signup-links';

function stubAddressBar(hash: string) {
  const replaceState = vi.fn();
  vi.stubGlobal('location', { hash, pathname: '/join', search: '?ref=mail' });
  vi.stubGlobal('history', { replaceState });
  return replaceState;
}

describe('readLinkCode', () => {
  it.each([
    ['#link=abc123', 'abc123'],
    ['#link=abc123&utm=x', 'abc123'],
    ['#utm=x&link=abc123', 'abc123'],
    ['#link=a%2Fb%3D', 'a/b='],
  ])('takes the code out of %j and clears the fragment', (hash, code) => {
    const replaceState = stubAddressBar(hash);
    expect(readLinkCode()).toBe(code);
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/join?ref=mail');
  });

  it.each([[''], ['#'], ['#link='], ['#other=1']])('returns "" for %j and leaves the URL alone', (hash) => {
    const replaceState = stubAddressBar(hash);
    expect(readLinkCode()).toBe('');
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('getSignupLinkContext', () => {
  it('GETs the context with the code in a header, not the URL', async () => {
    const context = { valid: true, credentialMode: 'Passwordless', maskedEmail: 'a•••@example.com', mode: 'Embedded' };
    const http = mockFetch({ body: context });
    await expect(getSignupLinkContext('code-1')).resolves.toEqual(context);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${SIGNUP_LINKS}/context`, body: undefined });
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key', 'X-Signup-Link-Code': 'code-1' });
  });

  it('rejects a bad link', async () => {
    mockFetch({ status: 404, body: { error: 'invalid_link' } });
    await expect(getSignupLinkContext('nope')).rejects.toMatchObject({ status: 404, body: { error: 'invalid_link' } });
  });

  it('treats a 401 as a bad link, not a lapsed session to refresh', async () => {
    const http = mockFetch({ status: 401, body: { error: 'invalid_link' } });
    await expect(getSignupLinkContext('nope')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(http.requests).toHaveLength(1);
  });
});

describe('redeemSignupLink', () => {
  it('POSTs the code and returns the answer untouched', async () => {
    const http = mockFetch({ body: { mode: 'Oidc', authorizeUrl: 'https://idp/authorize' } });
    await expect(redeemSignupLink('code-1')).resolves.toEqual({ mode: 'Oidc', authorizeUrl: 'https://idp/authorize' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${SIGNUP_LINKS}/redeem`, body: { code: 'code-1' } });
  });
});

describe('completeSignupLinkMfa', () => {
  it('POSTs the mfa id and code', async () => {
    const http = mockFetch({ body: { token_type: 'Bearer', cookie_set: true } });
    await completeSignupLinkMfa('m1', '123456');
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${SIGNUP_LINKS}/redeem/mfa`,
      body: { mfaId: 'm1', mfaCode: '123456' },
    });
  });
});

describe('authenticateSignupLink', () => {
  it('POSTs the redemption id and password', async () => {
    const http = mockFetch({ body: {} });
    await authenticateSignupLink('r1', 'pw');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${SIGNUP_LINKS}/redeem/authenticate` });
    expect(http.last().body).toEqual({ redemptionId: 'r1', password: 'pw' });
  });

  it('adds the captcha answer as snake_case captcha_code', async () => {
    const http = mockFetch({ body: {} });
    await authenticateSignupLink('r1', 'pw', 'answer');
    expect(http.last().body).toEqual({ redemptionId: 'r1', password: 'pw', captcha_code: 'answer' });
  });
});

describe('redeemOutcome', () => {
  it.each<[string, RedeemSignupLinkResponse, RedeemOutcome]>([
    [
      'an OIDC MFA challenge',
      { mode: 'Oidc', mfaId: 'm1', userMfa: 'Email' },
      { kind: 'mfa', mfaId: 'm1', userMfa: 'Email' },
    ],
    [
      'an embedded MFA challenge riding in the error slot',
      { error: 'mfa_enabled', mfa_required: true, mfa_id: 'm2' },
      { kind: 'mfa', mfaId: 'm2', userMfa: undefined },
    ],
    [
      'a password demand for an existing user',
      { error: 'authentication_required', redemptionId: 'r1', maskedEmail: 'a•••@x.io' },
      { kind: 'authenticate', redemptionId: 'r1', maskedEmail: 'a•••@x.io' },
    ],
    ['a PasswordRequired activation', { mode: 'Oidc', activationKey: 'k1' }, { kind: 'activate', activationKey: 'k1' }],
    ['an OIDC authorize URL', { mode: 'Oidc', authorizeUrl: 'https://a' }, { kind: 'navigate', url: 'https://a' }],
    ['an OIDC login URL', { mode: 'Oidc', loginUrl: 'https://l' }, { kind: 'navigate', url: 'https://l' }],
    [
      'embedded tokens in cookies, with a landing page',
      { token_type: 'Bearer', cookie_set: true, forwardedTo: '/projects' },
      { kind: 'signed-in', forwardedTo: '/projects' },
    ],
    ['an id_token alone', { id_token: 'jwt' }, { kind: 'signed-in', forwardedTo: null }],
    ['an access_token alone', { access_token: 'jwt' }, { kind: 'signed-in', forwardedTo: null }],
    [
      'an off-site landing page',
      { token_type: 'Bearer', forwardedTo: '//evil.example.com' },
      { kind: 'signed-in', forwardedTo: null },
    ],
    [
      'tokens that were not put in cookies',
      { token_type: 'Bearer', cookie_set: false, access_token: 'jwt' },
      { kind: 'error', error: 'tokens_not_in_cookie' },
    ],
    ['an IAM error code', { error: 'expired' }, { kind: 'error', error: 'expired' }],
    [
      'authentication_required without a redemption id',
      { error: 'authentication_required' },
      { kind: 'error', error: 'authentication_required' },
    ],
    ['an OIDC answer with nowhere to go', { mode: 'Oidc' }, { kind: 'error', error: 'invalid_link' }],
    ['an empty answer', {}, { kind: 'error', error: 'invalid_link' }],
  ])('reads %s', (_label, response, outcome) => {
    expect(redeemOutcome(response)).toEqual(outcome);
  });

  it('checks MFA before the error slot and before tokens', () => {
    const response = { mfaId: 'm1', error: 'authentication_required', redemptionId: 'r1', token_type: 'x' };
    expect(redeemOutcome(response)).toEqual({ kind: 'mfa', mfaId: 'm1', userMfa: undefined });
  });

  it('prefers the activation key over a URL, and the authorize URL over the login URL', () => {
    expect(redeemOutcome({ activationKey: 'k1', authorizeUrl: 'https://a' })).toEqual({
      kind: 'activate',
      activationKey: 'k1',
    });
    expect(redeemOutcome({ authorizeUrl: 'https://a', loginUrl: 'https://l' })).toEqual({
      kind: 'navigate',
      url: 'https://a',
    });
  });
});

describe('joinErrorMessage', () => {
  const misconfigured =
    'This invitation cannot be completed because the application is not set up correctly. Let whoever invited you know.';

  it.each([
    ['invalid_link', 'This invitation link is not valid. Ask whoever invited you to send a new one.'],
    ['expired', 'This invitation has expired. Ask whoever invited you to send a new one.'],
    ['revoked', 'This invitation has been withdrawn. Get in touch with whoever invited you.'],
    ['exhausted', 'This invitation has already been used.'],
    ['client_invalid', misconfigured],
    ['provider_not_registered', misconfigured],
    ['tokens_not_in_cookie', misconfigured],
    ['something_new', 'This invitation could not be completed. Ask whoever invited you to send a new one.'],
  ])('words %s for the invitee', (code, message) => {
    expect(joinErrorMessage(code)).toBe(message);
  });
});

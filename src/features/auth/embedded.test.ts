import { describe, expect, it, vi } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import {
  type SsoProvider,
  SOCIAL_REDIRECT_URI,
  finishSocialLogin,
  getLoginOptions,
  loginWithPassword,
  mfaChallenge,
  mfaChallengeFromError,
  pendingProviderName,
  restartSocialLogin,
  signUpWithSso,
  startSocialLogin,
  submitMfaCode,
  unknownUserEmail,
} from './embedded';

// SOCIAL_REDIRECT_URI is read from the live origin when the module loads, so the origin has to
// exist before the imports run — vi.hoisted is lifted above them. The dev-server port is there to
// prove it gets dropped.
vi.hoisted(() => {
  vi.stubGlobal('location', { origin: 'https://app.example.com:5173' });
});

const IAM ='https://blocksapi.example.com/iam/v4';
const PROVIDER_KEY = 'blocks.sso.provider';

const google: SsoProvider = {
  provider: 'google',
  displayName: 'Google',
  icon: 'google.svg',
  clientId: 'google-client-id',
  redirectUris: ['https://app.example.com/callback'],
};

function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { origin: 'https://app.example.com', assign });
  return assign;
}

function stubSessionStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

/** Resolves to 'pending' when the promise has not settled within a short wait. */
async function stateOf(promise: Promise<unknown>): Promise<'pending' | 'settled'> {
  const timeout = new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20));
  const settled = promise.then(
    () => 'settled' as const,
    () => 'settled' as const,
  );
  return Promise.race([settled, timeout]);
}

describe('SOCIAL_REDIRECT_URI', () => {
  it('is the live origin’s /callback, without the port', () => {
    expect(SOCIAL_REDIRECT_URI).toBe('https://app.example.com/callback');
  });
});

describe('getLoginOptions', () => {
  it('GETs the login options without the refresh-and-retry', async () => {
    const http = mockFetch({ body: { allowedGrantTypes: ['password'], ssoInfo: [google] } });
    await expect(getLoginOptions()).resolves.toEqual({ allowedGrantTypes: ['password'], ssoInfo: [google] });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/auth/login-options` });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('turns missing lists into empty ones', async () => {
    mockFetch({ body: { allowedGrantTypes: null, ssoInfo: null } });
    await expect(getLoginOptions()).resolves.toEqual({ allowedGrantTypes: [], ssoInfo: [] });
  });
});

describe('mfaChallenge', () => {
  it.each([
    [
      'mfa_required with a numeric type',
      { mfa_required: true, mfa_id: 'm1', mfa_type: 2, mfa_methods: 'Email' },
      { mfaId: 'm1', type: 2, methods: 'Email' },
    ],
    [
      'error mfa_enabled with a string type',
      { error: 'mfa_enabled', mfa_id: 'm2', mfa_type: '1' },
      { mfaId: 'm2', type: 1, methods: '' },
    ],
    [
      'an unparsable type',
      { mfa_required: true, mfa_id: 'm3', mfa_type: 'email' },
      { mfaId: 'm3', type: null, methods: '' },
    ],
    ['a missing type', { mfa_required: true, mfa_id: 'm4' }, { mfaId: 'm4', type: null, methods: '' }],
    [
      'a JSON-string body',
      JSON.stringify({ error: 'mfa_enabled', mfa_id: 'm5', mfa_type: 2 }),
      { mfaId: 'm5', type: 2, methods: '' },
    ],
  ])('reads %s', (_label, body, expected) => {
    expect(mfaChallenge(body)).toEqual(expected);
  });

  it.each([
    ['no mfa_id', { mfa_required: true, error: 'mfa_enabled' }],
    ['an mfa_id without any MFA marker', { mfa_id: 'm1', error: 'invalid_username_password' }],
    ['mfa_required false', { mfa_id: 'm1', mfa_required: false }],
    ['a plain-text body', 'mfa_enabled'],
    ['a null body', null],
    ['a numeric body', 2],
  ])('is null for %s', (_label, body) => {
    expect(mfaChallenge(body)).toBeNull();
  });
});

describe('mfaChallengeFromError', () => {
  it('reads the challenge out of a BlocksError body', () => {
    const error = new BlocksError(400, `${IAM}/auth/login`, { error: 'mfa_enabled', mfa_id: 'm1', mfa_type: 2 });
    expect(mfaChallengeFromError(error)).toEqual({ mfaId: 'm1', type: 2, methods: '' });
  });

  it('is null for anything else', () => {
    expect(mfaChallengeFromError(new Error('mfa_enabled'))).toBeNull();
    expect(mfaChallengeFromError({ body: { error: 'mfa_enabled', mfa_id: 'm1' } })).toBeNull();
  });
});

describe('loginWithPassword', () => {
  it('POSTs the credentials and reports a session', async () => {
    const http = mockFetch({ body: { token_type: 'Bearer', cookie_set: true } });
    await expect(loginWithPassword('ada@example.com', 's3cret')).resolves.toEqual({ status: 'signed-in' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/login` });
    expect(http.last().body).toEqual({ username: 'ada@example.com', password: 's3cret' });
  });

  it('sends the captcha answer as snake_case captcha_code', async () => {
    const http = mockFetch({ body: {} });
    await loginWithPassword('ada@example.com', 's3cret', 'captcha-answer');
    expect(http.last().body).toEqual({ username: 'ada@example.com', password: 's3cret', captcha_code: 'captcha-answer' });
  });

  it('leaves an empty captcha answer out', async () => {
    const http = mockFetch({ body: {} });
    await loginWithPassword('ada@example.com', 's3cret', '');
    expect(http.last().body).not.toHaveProperty('captcha_code');
  });

  it('treats an empty 204 as signed in', async () => {
    mockFetch({ status: 204 });
    await expect(loginWithPassword('ada@example.com', 's3cret')).resolves.toEqual({ status: 'signed-in' });
  });

  it('returns the MFA challenge IAM sends with a 200', async () => {
    mockFetch({ body: { error: 'mfa_enabled', mfa_id: 'm1', mfa_type: 2, mfa_methods: 'Email' } });
    await expect(loginWithPassword('ada@example.com', 's3cret')).resolves.toEqual({
      status: 'mfa-required',
      challenge: { mfaId: 'm1', type: 2, methods: 'Email' },
    });
  });

  it('returns the MFA challenge when IAM frames it as a 4xx', async () => {
    mockFetch({ status: 400, body: { mfa_required: true, mfa_id: 'm1', mfa_type: 2 } });
    await expect(loginWithPassword('ada@example.com', 's3cret')).resolves.toEqual({
      status: 'mfa-required',
      challenge: { mfaId: 'm1', type: 2, methods: '' },
    });
  });

  it('rethrows any other failure', async () => {
    mockFetch({ status: 400, body: { error: 'invalid_username_password' } });
    const failure = loginWithPassword('ada@example.com', 'wrong');
    await expect(failure).rejects.toBeInstanceOf(BlocksError);
    await expect(failure).rejects.toMatchObject({ status: 400, body: { error: 'invalid_username_password' } });
  });
});

describe('submitMfaCode', () => {
  it('POSTs the code with the challenge’s id and type, and nothing else', async () => {
    const http = mockFetch({ body: {} });
    await submitMfaCode({ mfaId: 'm1', type: 2, methods: 'Email' }, '123456');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/login` });
    expect(http.last().body).toEqual({ mfa_id: 'm1', mfa_code: '123456', mfa_type: 2 });
  });

  it('keeps a zero type, and leaves an unknown one out', async () => {
    const http = mockFetch({ body: {} });
    await submitMfaCode({ mfaId: 'm1', type: 0, methods: '' }, '1');
    expect(http.last().body).toEqual({ mfa_id: 'm1', mfa_code: '1', mfa_type: 0 });
    await submitMfaCode({ mfaId: 'm1', type: null, methods: '' }, '1');
    expect(http.last().body).toEqual({ mfa_id: 'm1', mfa_code: '1' });
  });

  it('rejects a wrong code', async () => {
    mockFetch({ status: 400, body: { error: 'invalid_mfa_code' } });
    await expect(submitMfaCode({ mfaId: 'm1', type: 2, methods: '' }, '0')).rejects.toMatchObject({ status: 400 });
  });
});

describe('startSocialLogin', () => {
  it('swaps the client id for an authorization URL, remembers the provider and navigates', async () => {
    const assign = stubLocation();
    const store = stubSessionStorage();
    const http = mockFetch({ body: { authorizationUrl: 'https://accounts.google.com/o/oauth2/auth?state=s1' } });

    const navigation = startSocialLogin(google);

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?state=s1'));
    expect(http.last()).toMatchObject({
      method: 'GET',
      url: `${IAM}/auth/social/initiate?clientId=google-client-id&redirectUri=https%3A%2F%2Fapp.example.com%2Fcallback`,
    });
    expect(store.get(PROVIDER_KEY)).toBe('google');
    await expect(stateOf(navigation)).resolves.toBe('pending');
  });

  it('rejects an answer without a URL, without navigating or remembering anything', async () => {
    const assign = stubLocation();
    const store = stubSessionStorage();
    mockFetch({ body: {} });

    await expect(startSocialLogin(google)).rejects.toThrow('social/initiate returned no authorization URL');
    expect(assign).not.toHaveBeenCalled();
    expect(store.has(PROVIDER_KEY)).toBe(false);
  });
});

describe('pendingProviderName', () => {
  it('reads the remembered provider, or null', () => {
    stubSessionStorage({ [PROVIDER_KEY]: 'microsoft' });
    expect(pendingProviderName()).toBe('microsoft');
    stubSessionStorage();
    expect(pendingProviderName()).toBeNull();
  });
});

describe('finishSocialLogin', () => {
  it('hands code, state and the remembered provider to IAM, then forgets the provider', async () => {
    const store = stubSessionStorage({ [PROVIDER_KEY]: 'google' });
    const http = mockFetch({ body: {} });

    await finishSocialLogin('?code=c1&state=s1');

    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/social/callback` });
    expect(http.last().body).toEqual({ code: 'c1', state: 's1', provider: 'google' });
    expect(store.has(PROVIDER_KEY)).toBe(false);
  });

  it('leaves the provider out when none was remembered', async () => {
    stubSessionStorage();
    const http = mockFetch({ body: {} });
    await finishSocialLogin('code=c1&state=s1');
    expect(http.last().body).toEqual({ code: 'c1', state: 's1' });
  });

  it('keeps the provider marker when IAM rejects the callback', async () => {
    const store = stubSessionStorage({ [PROVIDER_KEY]: 'google' });
    mockFetch({ status: 400, body: { error: 'user_not_found', error_description: 'ada@example.com does not exist' } });
    await expect(finishSocialLogin('?code=c1&state=s1')).rejects.toBeInstanceOf(BlocksError);
    expect(store.get(PROVIDER_KEY)).toBe('google');
  });

  it.each([
    ['?error=access_denied&error_description=User%20cancelled', 'User cancelled'],
    ['?error=access_denied', 'access_denied'],
    ['?code=c1', 'The provider returned no authorization code.'],
    ['?state=s1', 'The provider returned no authorization code.'],
    ['', 'The provider returned no authorization code.'],
  ])('rejects %j with %j and calls nothing', async (search, message) => {
    stubSessionStorage();
    const http = mockFetch();
    await expect(finishSocialLogin(search)).rejects.toThrow(message);
    expect(http.requests).toHaveLength(0);
  });
});

describe('signUpWithSso', () => {
  it('POSTs an SSO signup with the trimmed name', async () => {
    const http = mockFetch({ body: {} });
    await signUpWithSso('ada@example.com', 'google', { firstName: '  Ada ', lastName: ' Lovelace' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/auth/signup` });
    expect(http.last().body).toEqual({
      email: 'ada@example.com',
      provider: 'google',
      isSsoSignup: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('leaves blank or missing names out', async () => {
    const http = mockFetch({ body: {} });
    await signUpWithSso('ada@example.com', 'google', { firstName: '   ' });
    expect(http.last().body).toEqual({ email: 'ada@example.com', provider: 'google', isSsoSignup: true });
    await signUpWithSso('ada@example.com', 'google');
    expect(http.last().body).toEqual({ email: 'ada@example.com', provider: 'google', isSsoSignup: true });
  });
});

describe('restartSocialLogin', () => {
  it('looks the provider up by name and starts its round-trip', async () => {
    const assign = stubLocation();
    const store = stubSessionStorage();
    const http = mockFetch([
      { body: { allowedGrantTypes: [], ssoInfo: [{ ...google, provider: 'microsoft', clientId: 'ms' }, google] } },
      { body: { authorizationUrl: 'https://accounts.google.com/auth' } },
    ]);

    const navigation = restartSocialLogin('google');

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/auth'));
    expect(http.requests.map((r) => r.url)).toEqual([
      `${IAM}/auth/login-options`,
      `${IAM}/auth/social/initiate?clientId=google-client-id&redirectUri=https%3A%2F%2Fapp.example.com%2Fcallback`,
    ]);
    expect(store.get(PROVIDER_KEY)).toBe('google');
    await expect(stateOf(navigation)).resolves.toBe('pending');
  });

  it.each([
    ['a provider that is no longer listed', [google]],
    ['no providers at all', null],
  ])('rejects %s', async (_label, ssoInfo) => {
    const http = mockFetch({ body: { allowedGrantTypes: [], ssoInfo } });
    await expect(restartSocialLogin('github')).rejects.toThrow('Provider "github" is no longer configured.');
    expect(http.requests).toHaveLength(1);
  });
});

describe('unknownUserEmail', () => {
  const userNotFound = (description?: string) =>
    new BlocksError(400, `${IAM}/auth/social/callback`, { error: 'user_not_found', error_description: description });

  it.each([
    ['the usual IAM wording', 'ada@example.com does not exist', 'ada@example.com'],
    ['an address mid-sentence', 'User ada@example.com does not exist', 'ada@example.com'],
    ['leading whitespace', '   ada@example.com does not exist', 'ada@example.com'],
    ['trailing whitespace', 'User ada@example.com   ', 'ada@example.com'],
    ['tabs and newlines as separators', 'User\tada@example.com\ndoes not exist', 'ada@example.com'],
    ['the first of several addresses', 'a@b.io and c@d.io', 'a@b.io'],
    ['an "@" at the start of an earlier word', '@handle ada@example.com', 'ada@example.com'],
    ['an "@" at the end of an earlier word', 'ada@ ada@example.com', 'ada@example.com'],
    ['a lone "@" before the address', 'at @ ada@example.com', 'ada@example.com'],
    ['a leading "@" with another inside the word', '@ada@example.com does not exist', '@ada@example.com'],
    ['two "@" side by side', 'x@@y', 'x@@y'],
    ['the shortest possible match', 'a@b', 'a@b'],
  ])('finds the address with %s', (_label, description, expected) => {
    expect(unknownUserEmail(userNotFound(description))).toBe(expected);
  });

  it.each([
    ['no "@" at all', 'that user does not exist'],
    ['an "@" only at the start of a word', '@ada does not exist'],
    ['an "@" only at the end of a word', 'ada@ does not exist'],
    ['a lone "@"', 'user @ does not exist'],
    ['an empty description', ''],
    ['whitespace only', '  \t '],
    ['no description', undefined],
  ])('is null for %s', (_label, description) => {
    expect(unknownUserEmail(userNotFound(description))).toBeNull();
  });

  it('is null for any other error code, or anything that is not a BlocksError', () => {
    const otherCode = new BlocksError(400, IAM, { error: 'provider_inactive', error_description: 'a@b.io' });
    expect(unknownUserEmail(otherCode)).toBeNull();
    expect(unknownUserEmail(new BlocksError(400, IAM, null))).toBeNull();
    expect(unknownUserEmail(new Error('a@b.io does not exist'))).toBeNull();
  });
});

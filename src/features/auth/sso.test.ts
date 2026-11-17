import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { finishLogin, startLogin } from './sso';

const IAM = 'https://blocksapi.example.com/iam/v4';
const INITIATE =
  `${IAM}/idp/initiate?x-blocks-key=test-project-key&clientId=test-client-id` +
  '&redirectUri=https%3A%2F%2Fapp.example.com%2Flogin%2Fcallback';

function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { origin: 'https://app.example.com', assign });
  return assign;
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

describe('startLogin', () => {
  it('fetches the authorize URL with the key in query and header, then navigates to it', async () => {
    const assign = stubLocation();
    const http = mockFetch({ body: { redirect_uri: 'https://iam.example.com/authorize?state=s1' } });

    const navigation = startLogin();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://iam.example.com/authorize?state=s1'));
    expect(http.requests).toHaveLength(1);
    expect(http.last()).toMatchObject({ method: 'GET', url: INITIATE });
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key' });
    await expect(stateOf(navigation)).resolves.toBe('pending');
  });

  it('sends the redirect URI without the dev-server port', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_REDIRECT_URI', 'https://app.example.com:5173/login/callback');
    const fresh = await import('./sso');
    const assign = stubLocation();
    const http = mockFetch({ body: { redirect_uri: 'https://iam.example.com/authorize' } });

    const navigation = fresh.startLogin();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(http.last().url).toBe(INITIATE);
    await expect(stateOf(navigation)).resolves.toBe('pending');
  });

  it('refuses to start without an OIDC client id, before any request', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_OIDC_CLIENT_ID', '');
    const fresh = await import('./sso');
    const http = mockFetch();

    await expect(fresh.startLogin()).rejects.toThrow(/^No OIDC client id configured\./);
    expect(http.requests).toHaveLength(0);
  });

  it.each([
    [{ status: 500, body: 'upstream exploded' }, 'initiate failed (500): upstream exploded'],
    [{ status: 502, body: '' }, 'initiate failed (502): no response body'],
    [{ body: {} }, 'initiate returned no redirect_uri'],
  ])('rejects %j without navigating', async (reply, message) => {
    const assign = stubLocation();
    mockFetch(reply);
    await expect(startLogin()).rejects.toThrow(message);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('finishLogin', () => {
  it('exchanges code and state with credentials included', async () => {
    const http = mockFetch({ body: {} });

    await expect(finishLogin('?code=c%2F1&state=s+1')).resolves.toBeNull();

    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/idp/callback?code=c%2F1&state=s%201` });
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key' });
    expect(http.fetchMock.mock.calls[0][1]?.credentials).toBe('include');
  });

  it.each([
    ['/projects/p1?tab=roles', '/projects/p1?tab=roles'],
    ['//evil.example.com', null],
    ['https://evil.example.com', null],
    ['projects', null],
  ])('returns the forwardedTo path %j as %j', async (forwardedTo, expected) => {
    mockFetch({ body: {} });
    const search = `?code=c1&state=s1&${new URLSearchParams({ forwardedTo })}`;
    await expect(finishLogin(search)).resolves.toBe(expected);
  });

  it.each([
    ['?error=access_denied', 'You cancelled the sign-in, or the identity provider refused it.'],
    [
      '?error=invalid_request&error_description=redirect_uri_mismatch',
      'The redirect URI this app sent does not match the one registered on the provider.',
    ],
    ['?error_description=Consent%20declined', 'Consent declined'],
    ['?code=c1', 'The sign-in response was missing its code and state. Start again from the sign-in page.'],
    ['?state=s1', 'The sign-in response was missing its code and state. Start again from the sign-in page.'],
    ['', 'The sign-in response was missing its code and state. Start again from the sign-in page.'],
  ])('rejects %j with a readable reason and no request', async (search, message) => {
    const http = mockFetch();
    await expect(finishLogin(search)).rejects.toThrow(message);
    expect(http.requests).toHaveLength(0);
  });

  it.each([
    [
      { status: 400, body: { error: 'state_data_not_found' } },
      'This sign-in link has already been used or has expired. Start again from the sign-in page.',
    ],
    [{ status: 400, body: { error: 'odd', error_description: 'Something odd' } }, 'Something odd'],
    [{ status: 500, body: '' }, 'Sign-in failed (500).'],
  ])('describes a rejected callback %j', async (reply, message) => {
    mockFetch(reply);
    await expect(finishLogin('?code=c1&state=s1')).rejects.toThrow(message);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import {
  FALLBACK_LIFETIME_MS,
  REFRESH_MARGIN_MS,
  SessionEndedError,
  onSessionEnded,
  useAuthStore,
} from './auth-store';

const OIDC_TOKEN = 'https://blocksapi.example.com/iam/v4/oidc/token';
const AUTH_REFRESH = 'https://blocksapi.example.com/iam/v4/auth/refresh';
const NOW = 1_700_000_000_000;

const refresh = () => useAuthStore.getState().refreshSession();
const failure = (): Promise<unknown> => refresh().then(() => 'resolved', (e: unknown) => e);

beforeEach(() => {
  // Node has a navigator without Web Locks; make that explicit so every test takes the same path.
  vi.stubGlobal('navigator', {});
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  // Resets the preferred endpoint and the timestamps between tests.
  useAuthStore.getState().clear();
});

describe('refreshSession', () => {
  it('renews through oidc/token first, with the refresh cookie and a form body', async () => {
    const http = mockFetch({ body: { expires_in: 300 } });
    await refresh();

    expect(http.requests).toHaveLength(1);
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: OIDC_TOKEN,
      body: 'grant_type=refresh_token&client_id=test-client-id',
      headers: { 'x-blocks-key': 'test-project-key', 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(http.fetchMock.mock.calls[0][1]?.credentials).toBe('include');
  });

  it('records when the session was renewed and when it expires', async () => {
    mockFetch({ body: { expires_in: 300 } });
    await refresh();
    expect(useAuthStore.getState()).toMatchObject({ lastRefreshedAt: NOW, expiresAt: NOW + 300_000 });
  });

  it.each([
    ['no expires_in', { access_token: 'x' }],
    ['a body that is not JSON', ''],
  ])('leaves the expiry unknown for %s', async (_label, body) => {
    mockFetch({ body });
    await refresh();
    expect(useAuthStore.getState()).toMatchObject({ lastRefreshedAt: NOW, expiresAt: null });
  });

  it.each([
    [401, 'invalid_client'],
    [400, 'invalid_client'],
    [400, 'invalid_request'],
  ])('falls back to auth/refresh after %i %s, and goes there first from then on', async (status, error) => {
    const http = mockFetch([{ status, body: { error } }, { body: { expires_in: 60 } }]);
    await refresh();

    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN, AUTH_REFRESH]);
    expect(http.requests[1]).toMatchObject({
      method: 'POST',
      body: {},
      headers: { 'x-blocks-key': 'test-project-key', 'Content-Type': 'application/json' },
    });
    expect(useAuthStore.getState().expiresAt).toBe(NOW + 60_000);

    await refresh();
    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN, AUTH_REFRESH, AUTH_REFRESH]);
  });

  it('starts from oidc/token again after clear()', async () => {
    const http = mockFetch([{ status: 401, body: { error: 'invalid_client' } }, {}]);
    await refresh();
    useAuthStore.getState().clear();
    await refresh();
    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN, AUTH_REFRESH, OIDC_TOKEN]);
  });

  it('keeps oidc/token preferred when auth/refresh refuses as well', async () => {
    const http = mockFetch([
      { status: 401, body: { error: 'invalid_client' } },
      { status: 400, body: { error: 'invalid_refresh_token' } },
      {},
    ]);

    const error = await failure();
    expect(error).toBeInstanceOf(SessionEndedError);
    expect(error).toMatchObject({ status: 400, body: { error: 'invalid_refresh_token' } });

    await refresh();
    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN, AUTH_REFRESH, OIDC_TOKEN]);
  });

  it.each([
    [400, { error: 'invalid_grant' }],
    [401, null],
    [403, { error: 'forbidden' }],
  ])('ends the session on %i %j without trying auth/refresh', async (status, body) => {
    const http = mockFetch({ status, body: body ?? '' });
    const listener = vi.fn();
    const unsubscribe = onSessionEnded(listener);
    useAuthStore.setState({ lastRefreshedAt: 1, expiresAt: 2 });

    const error = await failure();
    unsubscribe();

    expect(error).toBeInstanceOf(SessionEndedError);
    expect(error).toMatchObject({
      name: 'SessionEndedError',
      status,
      body,
      message: `session ended: refresh refused with ${status}`,
    });
    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ lastRefreshedAt: null, expiresAt: null });
  });

  it('does not fall back from auth/refresh once that is the preferred endpoint', async () => {
    const http = mockFetch([
      { status: 401, body: { error: 'invalid_client' } },
      {},
      { status: 401, body: { error: 'invalid_client' } },
    ]);
    await refresh();

    await expect(failure()).resolves.toBeInstanceOf(SessionEndedError);
    expect(http.requests.map((r) => r.url)).toEqual([OIDC_TOKEN, AUTH_REFRESH, AUTH_REFRESH]);
  });

  it('treats a server error as a failed attempt, not a session that ended', async () => {
    mockFetch({ status: 503, body: 'unavailable' });
    const listener = vi.fn();
    const unsubscribe = onSessionEnded(listener);
    useAuthStore.setState({ lastRefreshedAt: 1, expiresAt: 2 });

    const error = await failure();
    unsubscribe();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SessionEndedError);
    expect(error).toMatchObject({ message: 'session refresh failed: 503' });
    expect(listener).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ lastRefreshedAt: 1, expiresAt: 2 });
  });

  it('shares one request between concurrent callers', async () => {
    const http = mockFetch({ body: { expires_in: 300 } });
    await Promise.all([refresh(), refresh(), refresh()]);
    expect(http.requests).toHaveLength(1);
  });

  it('tells every listener once per refused renewal, however many callers waited on it', async () => {
    mockFetch({ status: 400, body: { error: 'invalid_grant' } });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onSessionEnded(first);
    const stopSecond = onSessionEnded(second);

    const results = await Promise.allSettled([refresh(), refresh()]);
    stopFirst();
    stopSecond();

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener once it unsubscribes', async () => {
    mockFetch({ status: 400, body: { error: 'invalid_grant' } });
    const listener = vi.fn();
    onSessionEnded(listener)();

    await failure();
    expect(listener).not.toHaveBeenCalled();
  });

  it('starts a new request once the previous one has settled, even after a network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{"expires_in":10}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(failure()).resolves.toBeInstanceOf(TypeError);
    await refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().expiresAt).toBe(NOW + 10_000);
  });

  it('renews behind a Web Lock when the browser has them', async () => {
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { locks: { request } });
    const http = mockFetch({ body: { expires_in: 300 } });

    await refresh();

    expect(request).toHaveBeenCalledWith('blocks-session-renewal', expect.any(Function));
    expect(http.requests).toHaveLength(1);
  });

  it('goes straight to auth/refresh when no OIDC client is configured', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_BLOCKS_OIDC_CLIENT_ID', '');
    const fresh = await import('./auth-store');
    const http = mockFetch({});

    await fresh.useAuthStore.getState().refreshSession();
    expect(http.requests.map((r) => r.url)).toEqual([AUTH_REFRESH]);
  });
});

describe('needsRefresh', () => {
  const needsRefresh = () => useAuthStore.getState().needsRefresh();

  it('is false before any renewal this page load', () => {
    expect(needsRefresh()).toBe(false);
  });

  it('turns true a minute before the reported expiry', () => {
    useAuthStore.setState({ expiresAt: NOW + REFRESH_MARGIN_MS + 1 });
    expect(needsRefresh()).toBe(false);
    useAuthStore.setState({ expiresAt: NOW + REFRESH_MARGIN_MS });
    expect(needsRefresh()).toBe(true);
  });

  it('falls back to the time since the last renewal when no expiry was reported', () => {
    const threshold = FALLBACK_LIFETIME_MS - REFRESH_MARGIN_MS;
    useAuthStore.setState({ expiresAt: null, lastRefreshedAt: NOW - threshold + 1 });
    expect(needsRefresh()).toBe(false);
    useAuthStore.setState({ lastRefreshedAt: NOW - threshold });
    expect(needsRefresh()).toBe(true);
  });

  it('uses the documented margins', () => {
    expect(REFRESH_MARGIN_MS).toBe(60_000);
    expect(FALLBACK_LIFETIME_MS).toBe(300_000);
  });
});

describe('clear', () => {
  it('drops the renewal timestamps', () => {
    useAuthStore.setState({ lastRefreshedAt: 1, expiresAt: 2 });
    useAuthStore.getState().clear();
    expect(useAuthStore.getState()).toMatchObject({ lastRefreshedAt: null, expiresAt: null });
  });
});

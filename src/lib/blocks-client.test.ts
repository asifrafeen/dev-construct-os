import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { SessionEndedError, useAuthStore } from '@/state/auth-store';
import { BlocksError, UnauthorizedError, blocksFetch } from './blocks-client';

const USERS_URL = 'https://blocksapi.example.com/iam/v4/users';

/** The RequestInit blocksFetch handed to fetch on the given call. */
function initOf(fetchMock: ReturnType<typeof mockFetch>['fetchMock'], call = 0): RequestInit {
  return fetchMock.mock.calls[call][1] ?? {};
}

describe('blocksFetch request', () => {
  it('sends the project key and the session cookie on every request', async () => {
    const http = mockFetch();
    await blocksFetch(USERS_URL);
    expect(http.last()).toMatchObject({ method: 'GET', url: USERS_URL, body: undefined });
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key' });
    expect(initOf(http.fetchMock).credentials).toBe('include');
  });

  it('keeps the cookie even when the caller asks to omit credentials', async () => {
    const http = mockFetch();
    await blocksFetch(USERS_URL, { credentials: 'omit' });
    expect(initOf(http.fetchMock).credentials).toBe('include');
  });

  it('passes the rest of the init through, and merges caller headers over the defaults', async () => {
    const http = mockFetch();
    const headers = { 'Accept-Language': 'de', 'Content-Type': 'text/json' };
    await blocksFetch(USERS_URL, { method: 'PUT', body: { a: 1 }, headers });
    expect(http.last()).toMatchObject({ method: 'PUT', body: { a: 1 } });
    expect(http.last().headers).toEqual({
      'x-blocks-key': 'test-project-key',
      'Content-Type': 'text/json',
      'Accept-Language': 'de',
    });
  });

  it('JSON-encodes plain objects and arrays, with a JSON Content-Type', async () => {
    const http = mockFetch();
    await blocksFetch(USERS_URL, { method: 'POST', body: { name: 'x', tags: ['a'] } });
    expect(http.last().body).toEqual({ name: 'x', tags: ['a'] });
    expect(initOf(http.fetchMock).body).toBe('{"name":"x","tags":["a"]}');
    expect(http.last().headers['Content-Type']).toBe('application/json');

    await blocksFetch(USERS_URL, { method: 'POST', body: [1, 2] });
    expect(initOf(http.fetchMock, 1).body).toBe('[1,2]');
    expect(http.last().headers['Content-Type']).toBe('application/json');
  });

  it.each([
    ['a string', 'grant_type=password'],
    ['URLSearchParams', new URLSearchParams({ a: '1' })],
    ['FormData', new FormData()],
    ['a Blob', new Blob(['abc'], { type: 'text/plain' })],
  ])('passes %s through untouched, without a Content-Type of its own', async (_label, body) => {
    const http = mockFetch();
    await blocksFetch(USERS_URL, { method: 'POST', body });
    expect(initOf(http.fetchMock).body).toBe(body);
    expect(http.last().headers).toEqual({ 'x-blocks-key': 'test-project-key' });
  });

  it('lets the caller set the Content-Type of a raw body', async () => {
    const http = mockFetch();
    const form = new URLSearchParams({ a: '1' });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    await blocksFetch(USERS_URL, { method: 'POST', body: form, headers });
    expect(http.last().headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('sends no body when none is given', async () => {
    const http = mockFetch();
    await blocksFetch(USERS_URL, { method: 'DELETE' });
    expect(initOf(http.fetchMock).body).toBeUndefined();
    expect(http.last().headers['Content-Type']).toBeUndefined();
  });
});

describe('blocksFetch response', () => {
  it('parses a JSON body', async () => {
    mockFetch({ body: { data: [1, 2] } });
    await expect(blocksFetch(USERS_URL)).resolves.toEqual({ data: [1, 2] });
  });

  it('returns a non-JSON body as text', async () => {
    mockFetch({ body: 'plain text' });
    await expect(blocksFetch(USERS_URL)).resolves.toBe('plain text');
  });

  it.each([
    ['a 204', { status: 204 }],
    ['an empty 200', { status: 200, body: '' }],
  ])('returns null for %s', async (_label, reply) => {
    mockFetch(reply);
    await expect(blocksFetch(USERS_URL)).resolves.toBeNull();
  });

  it('throws a BlocksError carrying the status, URL and parsed body on a non-2xx reply', async () => {
    mockFetch({ status: 422, body: { errors: { name: 'required' } } });
    const error: unknown = await blocksFetch(USERS_URL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlocksError);
    expect(error).not.toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      name: 'BlocksError',
      status: 422,
      url: USERS_URL,
      body: { errors: { name: 'required' } },
      message: `Blocks 422 — ${USERS_URL}`,
    });
  });

  it('keeps a text error body as text', async () => {
    mockFetch({ status: 500, body: 'upstream exploded' });
    await expect(blocksFetch(USERS_URL)).rejects.toMatchObject({ status: 500, body: 'upstream exploded' });
  });
});

describe('blocksFetch on 401', () => {
  it('refreshes the session once and replays the same request', async () => {
    const http = mockFetch([{ status: 401, body: { error: 'expired' } }, { body: { id: 'u1' } }]);
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue();

    const result = await blocksFetch(USERS_URL, { method: 'POST', body: { a: 1 } });

    expect(result).toEqual({ id: 'u1' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
    expect(http.requests[1]).toEqual(http.requests[0]);
    expect(initOf(http.fetchMock, 1).credentials).toBe('include');
  });

  it('throws UnauthorizedError with the first reply when the refresh fails', async () => {
    const http = mockFetch({ status: 401, body: { error: 'no session' } });
    const refresh = vi
      .spyOn(useAuthStore.getState(), 'refreshSession')
      .mockRejectedValue(new SessionEndedError(400, { error: 'invalid_grant' }));

    const error: unknown = await blocksFetch(USERS_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toBeInstanceOf(BlocksError);
    expect(error).toMatchObject({
      name: 'UnauthorizedError',
      status: 401,
      url: USERS_URL,
      body: { error: 'no session' },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(1);
  });

  it('throws UnauthorizedError with the replay reply when the replay is 401 again', async () => {
    const http = mockFetch([
      { status: 401, body: { attempt: 1 } },
      { status: 401, body: { attempt: 2 } },
    ]);
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue();

    const error: unknown = await blocksFetch(USERS_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ status: 401, body: { attempt: 2 } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
  });

  it('surfaces a non-401 failure of the replay as a plain BlocksError', async () => {
    mockFetch([{ status: 401 }, { status: 503, body: 'down' }]);
    vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue();

    const error: unknown = await blocksFetch(USERS_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BlocksError);
    expect(error).not.toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ status: 503, body: 'down' });
  });

  it('skips the refresh with noRetry and does not send noRetry to fetch', async () => {
    const http = mockFetch({ status: 401, body: '' });
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue();

    const error: unknown = await blocksFetch(USERS_URL, { noRetry: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ status: 401, body: null });
    expect(refresh).not.toHaveBeenCalled();
    expect(http.requests).toHaveLength(1);
    expect(initOf(http.fetchMock)).not.toHaveProperty('noRetry');
  });
});

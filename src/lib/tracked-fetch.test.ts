import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { useApiLog, type ApiLogEntry } from '@/state/api-log';
import { trackedFetch } from './tracked-fetch';

const IAM_URL = 'https://blocksapi.example.com/iam/v4/users/me';

const entries = () => useApiLog.getState().entries;

/** Waits for the single entry trackedFetch logs once it has read the response body. */
async function loggedEntry(): Promise<ApiLogEntry> {
  await vi.waitFor(() => expect(entries()).toHaveLength(1));
  return entries()[0];
}

beforeEach(() => {
  useApiLog.setState({ entries: [], paused: false });
});

describe('trackedFetch', () => {
  it('calls fetch with the init as given, minus logBody', async () => {
    const http = mockFetch();
    await trackedFetch(IAM_URL, { method: 'POST', body: '{"a":1}', logBody: { a: 'logged' }, credentials: 'include' });
    expect(http.fetchMock).toHaveBeenCalledWith(IAM_URL, { method: 'POST', body: '{"a":1}', credentials: 'include' });
  });

  it('logs the call: method, service, status, timing and parsed bodies', async () => {
    mockFetch({ status: 201, body: { id: 'u1' } });
    await trackedFetch(IAM_URL, { method: 'post', body: '{"name":"Ada"}' });

    const entry = await loggedEntry();
    expect(entry).toMatchObject({
      method: 'POST',
      url: IAM_URL,
      service: 'iam',
      status: 201,
      ok: true,
      traceId: null,
      requestBody: { name: 'Ada' },
      responseBody: { id: 'u1' },
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(entry.startedAt))).toBe(false);
    expect(entry.error).toBeUndefined();
  });

  it('defaults to GET with no request body', async () => {
    mockFetch({ body: 'not json' });
    await trackedFetch('https://blocksapi.example.com/data/v4/x');

    const entry = await loggedEntry();
    expect(entry).toMatchObject({ method: 'GET', service: 'data', requestBody: undefined, responseBody: 'not json' });
  });

  it('logs a failed status as not ok, and still hands the caller an unread body', async () => {
    mockFetch({ status: 404, body: { error: 'missing' } });
    const res = await trackedFetch(IAM_URL);

    await expect(res.json()).resolves.toEqual({ error: 'missing' });
    expect(await loggedEntry()).toMatchObject({ status: 404, ok: false, responseBody: { error: 'missing' } });
  });

  it('logs no response body for an empty reply', async () => {
    mockFetch({ status: 204 });
    await trackedFetch(IAM_URL, { method: 'DELETE' });
    expect((await loggedEntry()).responseBody).toBeUndefined();
  });

  it.each([
    ['x-request-id', 'req-123', 'req-123'],
    ['x-correlation-id', 'corr-9', 'corr-9'],
    ['traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', '4bf92f3577b34da6a3ce929d0e0e4736'],
  ])('takes the trace id from %s', async (header, value, expected) => {
    mockFetch({ headers: { [header]: value } });
    await trackedFetch(IAM_URL);
    expect((await loggedEntry()).traceId).toBe(expected);
  });

  it('redacts secret fields in both bodies', async () => {
    mockFetch({ body: { access_token: 'at', refresh_token: 'rt', expires_in: 300 } });
    await trackedFetch(IAM_URL, { method: 'POST', body: '{"email":"a@x.io","password":"hunter2"}' });

    const entry = await loggedEntry();
    expect(entry.requestBody).toEqual({ email: 'a@x.io', password: '***' });
    expect(entry.responseBody).toEqual({ access_token: '***', refresh_token: '***', expires_in: 300 });
  });

  it('logs logBody instead of the wire body, redacted', async () => {
    mockFetch();
    const form = new URLSearchParams({ grant_type: 'password', password: 'hunter2' });
    await trackedFetch(IAM_URL, { method: 'POST', body: form, logBody: { username: 'ada', password: 'hunter2' } });
    expect((await loggedEntry()).requestBody).toEqual({ username: 'ada', password: '***' });
  });

  it.each([
    ['URLSearchParams', new URLSearchParams({ client_id: 'c', code: '123456' }), { client_id: 'c', code: '***' }],
    ['FormData', new FormData(), '[multipart form data]'],
    ['a Blob', new Blob(['abcd']), '[binary 4 bytes]'],
  ])('summarises a %s request body', async (_label, body, expected) => {
    mockFetch();
    await trackedFetch(IAM_URL, { method: 'POST', body });
    expect((await loggedEntry()).requestBody).toEqual(expected);
  });

  it.each([
    'https://blocksapi.example.com/utilities/v1/Secrets/value',
    'https://blocksapi.example.com/utilities/v1/Secrets/values?Keys=a',
    'https://blocksapi.example.com/utilities/v1/secrets/Value?Key=a',
    'https://blocksapi.example.com/deploy/v1/RepoSecret/value?name=x',
  ])('masks the whole response of the secret-value route %s', async (url) => {
    mockFetch({ body: { value: 's3cr3t' } });
    const res = await trackedFetch(url);

    // Logged synchronously, without reading the body.
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ url, status: 200, responseBody: '[redacted: secret value]' });
    await expect(res.json()).resolves.toEqual({ value: 's3cr3t' });
  });

  it('does not mask other routes that merely mention secrets', async () => {
    mockFetch({ body: { value: 'not-a-secret' } });
    await trackedFetch('https://blocksapi.example.com/utilities/v1/Secrets/list');
    expect((await loggedEntry()).responseBody).toEqual({ value: 'not-a-secret' });
  });

  it('logs the entry without a response body when the body cannot be read', async () => {
    const res = new Response('x');
    const unreadable = Object.assign(new Response(), { text: () => Promise.reject(new Error('opaque')) });
    vi.spyOn(res, 'clone').mockReturnValue(unreadable);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    await expect(trackedFetch(IAM_URL)).resolves.toBe(res);
    const entry = await loggedEntry();
    expect(entry).toMatchObject({ status: 200, ok: true });
    expect(entry).not.toHaveProperty('responseBody');
  });

  it('logs a network failure with no status and rethrows it', async () => {
    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await expect(trackedFetch(IAM_URL, { method: 'PUT', body: '{"token":"t"}' })).rejects.toBe(failure);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      method: 'PUT',
      url: IAM_URL,
      service: 'iam',
      status: null,
      ok: false,
      traceId: null,
      requestBody: { token: '***' },
      error: 'Failed to fetch',
    });
  });

  it('stringifies a non-Error rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('aborted'));
    await expect(trackedFetch(IAM_URL)).rejects.toBe('aborted');
    expect(entries()[0].error).toBe('aborted');
  });

  it('logs nothing while the inspector is paused', async () => {
    useApiLog.getState().setPaused(true);
    mockFetch();
    const res = await trackedFetch(IAM_URL);
    await res.text();
    // Give the background body read time to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(entries()).toEqual([]);
  });
});

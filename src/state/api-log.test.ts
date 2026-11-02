import { beforeEach, describe, expect, it } from 'vitest';
import { redact, serviceOf, traceIdOf, useApiLog, type ApiLogEntry } from './api-log';

const entry = (url: string): Omit<ApiLogEntry, 'id'> => ({
  method: 'GET',
  url,
  service: serviceOf(url),
  status: 200,
  ok: true,
  durationMs: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  traceId: null,
});

describe('useApiLog', () => {
  beforeEach(() => {
    useApiLog.setState({ entries: [], paused: false });
  });

  it('keeps entries newest first, each with a fresh id', () => {
    const { add } = useApiLog.getState();
    add(entry('https://a.io/one'));
    add(entry('https://a.io/two'));

    const [newest, oldest] = useApiLog.getState().entries;
    expect(newest.url).toBe('https://a.io/two');
    expect(oldest.url).toBe('https://a.io/one');
    expect(newest.id).toBeGreaterThan(oldest.id);
  });

  it('caps the log at 300 entries, dropping the oldest', () => {
    const { add } = useApiLog.getState();
    for (let i = 0; i < 305; i++) add(entry(`https://a.io/${i}`));

    const { entries } = useApiLog.getState();
    expect(entries).toHaveLength(300);
    expect(entries[0].url).toBe('https://a.io/304');
    expect(entries.at(-1)?.url).toBe('https://a.io/5');
  });

  it('ignores new entries while paused, and records again once resumed', () => {
    const { add, setPaused } = useApiLog.getState();
    setPaused(true);
    add(entry('https://a.io/ignored'));
    expect(useApiLog.getState()).toMatchObject({ paused: true, entries: [] });

    setPaused(false);
    add(entry('https://a.io/kept'));
    expect(useApiLog.getState().entries.map((e) => e.url)).toEqual(['https://a.io/kept']);
  });

  it('clears every entry', () => {
    useApiLog.getState().add(entry('https://a.io/x'));
    useApiLog.getState().clear();
    expect(useApiLog.getState().entries).toEqual([]);
  });
});

describe('serviceOf', () => {
  it.each([
    ['https://blocksapi.example.com/iam/v4/users', 'iam'],
    ['https://blocksapi.example.com//data/v4/x', 'data'],
    ['https://blocksapi.example.com/logic', 'logic'],
    ['https://blocksapi.example.com/', ''],
    ['not a url', ''],
  ])('%s → %j', (url, expected) => {
    expect(serviceOf(url)).toBe(expected);
  });
});

describe('traceIdOf', () => {
  it.each(['x-trace-id', 'trace-id', 'x-correlation-id', 'x-request-id', 'request-id'])('reads %s as is', (name) => {
    expect(traceIdOf(new Headers({ [name]: 'abc-123' }))).toBe('abc-123');
  });

  it('takes the trace id out of a W3C traceparent', () => {
    const headers = new Headers({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' });
    expect(traceIdOf(headers)).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('keeps a traceparent that is not in the W3C shape', () => {
    expect(traceIdOf(new Headers({ traceparent: 'opaque' }))).toBe('opaque');
  });

  it('prefers traceparent, then the headers in listed order', () => {
    const all = new Headers({ 'x-request-id': 'req', 'x-trace-id': 'trace', traceparent: '00-tid-sid-01' });
    expect(traceIdOf(all)).toBe('tid');
    expect(traceIdOf(new Headers({ 'request-id': 'late', 'x-correlation-id': 'early' }))).toBe('early');
  });

  it('skips empty values and returns null when nothing is there', () => {
    expect(traceIdOf(new Headers({ 'x-trace-id': '', 'request-id': 'r' }))).toBe('r');
    expect(traceIdOf(new Headers())).toBeNull();
  });
});

describe('redact', () => {
  it.each([
    'password',
    'newPassword',
    'clientSecret',
    'secret',
    'access_token',
    'refreshToken',
    'code',
    'verificationCode',
    'captchaCode',
    'captchaResponse',
    'otp',
    'Authorization',
    'OTP',
  ])('masks %s', (key) => {
    expect(redact({ [key]: 'value', keep: 'me' })).toEqual({ [key]: '***', keep: 'me' });
  });

  const harmless = ['languageCode', 'shortCode', 'tokenType', 'passwordPolicy', 'secretName', 'email'];

  it.each(harmless)('leaves %s alone', (key) => {
    expect(redact({ [key]: 'value' })).toEqual({ [key]: 'value' });
  });

  it('masks numbers and booleans under a secret key too', () => {
    expect(redact({ otp: 123456, code: 0, token: false })).toEqual({ otp: '***', code: '***', token: '***' });
  });

  it('masks at any depth, inside objects and arrays', () => {
    const body = { user: { profile: { password: 'p' } }, items: [{ token: 't', id: 1 }] };
    expect(redact(body)).toEqual({ user: { profile: { password: '***' } }, items: [{ token: '***', id: 1 }] });
  });

  it('descends into an object under a secret key instead of masking it whole', () => {
    expect(redact({ token: { kind: 'bearer', accessToken: 'at' } })).toEqual({
      token: { kind: 'bearer', accessToken: '***' },
    });
  });

  it('masks secret fields of URLSearchParams', () => {
    const form = new URLSearchParams({ grant_type: 'password', username: 'ada', password: 'p' });
    expect(redact(form)).toEqual({ grant_type: 'password', username: 'ada', password: '***' });
  });

  it('summarises multipart and binary bodies', () => {
    expect(redact(new FormData())).toBe('[multipart form data]');
    expect(redact(new Blob(['abc']))).toBe('[binary 3 bytes]');
  });

  it('truncates a huge string', () => {
    const huge = 'x'.repeat(20_001);
    expect(redact(huge)).toBe(`${'x'.repeat(20_000)}… (truncated)`);
    expect(redact('x'.repeat(20_000))).toBe('x'.repeat(20_000));
  });

  it('keeps at most 200 array items', () => {
    const list = Array.from({ length: 250 }, (_, i) => i);
    expect(redact(list)).toEqual(list.slice(0, 200));
  });

  it.each([null, undefined, 42, true])('passes %j through', (value) => {
    expect(redact(value)).toBe(value);
  });
});

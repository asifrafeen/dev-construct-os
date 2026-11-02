import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { UnauthorizedError } from '@/lib/blocks-client';
import { useAuthStore } from '@/state/auth-store';
import { SESSION_STATUS, security, sessionStatusLabel } from './api';

const IAM = 'https://blocksapi.example.com/iam/v4';

describe('sessionStatusLabel', () => {
  it.each([
    [0, 'Active'],
    [1, 'Expired'],
    [2, 'Revoked'],
    [7, '7'],
    ['Revoked', 'Revoked'],
    ['Expired', 'Expired'],
    [undefined, 'Active'],
    [null, 'Active'],
  ])('%j → %s', (status, expected) => {
    expect(sessionStatusLabel(status)).toBe(expected);
  });

  it('lists the statuses in IAM’s enum order', () => {
    expect(SESSION_STATUS).toEqual(['Active', 'Expired', 'Revoked']);
  });
});

describe('security account calls', () => {
  it('changePassword posts both passwords', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(security.changePassword('old', 'new')).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${IAM}/auth/change-password`,
      body: { oldPassword: 'old', newPassword: 'new' },
    });
  });

  it('passwordCheck posts the candidate and returns the bare boolean', async () => {
    const http = mockFetch({ body: false });
    await expect(security.passwordCheck('weak')).resolves.toBe(false);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/idp/password-check`, body: { password: 'weak' } });
  });

  it('passwordCheck never tries to renew the session', async () => {
    const http = mockFetch({ status: 401 });
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue();

    await expect(security.passwordCheck('x')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(refresh).not.toHaveBeenCalled();
    expect(http.requests).toHaveLength(1);
  });

  it('logoutAll skips the back-channel unless asked', async () => {
    const http = mockFetch({ body: { isSuccess: true, sessionLoggedOut: 3 } });
    await expect(security.logoutAll()).resolves.toEqual({ isSuccess: true, sessionLoggedOut: 3 });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${IAM}/auth/logout-all`,
      body: { useBackchannel: false },
    });

    await security.logoutAll(true);
    expect(http.last().body).toEqual({ useBackchannel: true });
  });

  it('userinfo reads the session’s claims', async () => {
    const http = mockFetch({ body: { sub: 'u1' } });
    await expect(security.userinfo()).resolves.toEqual({ sub: 'u1' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/auth/me` });
  });
});

describe('security sessions', () => {
  it('summary and sessions read "me" without a uid', async () => {
    const http = mockFetch({ body: { totalSessions: 2 } });
    await expect(security.summary()).resolves.toEqual({ totalSessions: 2 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/security/summary` });

    await security.sessions();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/security/sessions` });
  });

  it('summary and sessions read someone else by an encoded uid', async () => {
    const http = mockFetch({ body: [] });
    await security.summary('a b/c');
    expect(http.last().url).toBe(`${IAM}/security/summary?uid=a%20b%2Fc`);

    await expect(security.sessions('u1')).resolves.toEqual([]);
    expect(http.last().url).toBe(`${IAM}/security/sessions?uid=u1`);
  });

  it('session reads one session by its encoded id', async () => {
    const http = mockFetch({ body: { overview: { sessionId: 's/1' } } });
    await expect(security.session('s/1')).resolves.toEqual({ overview: { sessionId: 's/1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/security/sessions/s%2F1` });

    await security.session('s1', 'u1');
    expect(http.last().url).toBe(`${IAM}/security/sessions/s1?uid=u1`);
  });

  it.each([
    ['revokeSession', security.revokeSession, 'sessions'],
    ['revokeRefreshToken', security.revokeRefreshToken, 'refresh-tokens'],
  ] as const)('%s always sends a body, with only the fields given', async (_name, revoke, segment) => {
    const http = mockFetch({ body: { alreadyRevoked: false } });

    await expect(revoke('id/1')).resolves.toEqual({ alreadyRevoked: false });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/security/${segment}/id%2F1/revoke`, body: {} });

    await revoke('id1', 'lost phone');
    expect(http.last().body).toEqual({ reason: 'lost phone' });

    await revoke('id1', undefined, 'u2');
    expect(http.last().body).toEqual({ userId: 'u2' });

    await revoke('id1', 'stolen', 'u2');
    expect(http.last().body).toEqual({ reason: 'stolen', userId: 'u2' });
  });
});

describe('security activity', () => {
  it('asks for the first page of 20 by default', async () => {
    const http = mockFetch({ body: { items: [], totalCount: 0 } });
    await expect(security.activity()).resolves.toEqual({ items: [], totalCount: 0 });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${IAM}/security/activity`,
      body: { page: 0, pageSize: 20 },
    });
  });

  it('sends every filter, and lets the query override the paging', async () => {
    const http = mockFetch();
    const query = { page: 2, pageSize: 50, userId: 'u1', categories: ['Auth'], outcomes: ['Failure'] };
    await security.activity(query);
    expect(http.last().body).toEqual(query);
  });
});

describe('security MFA', () => {
  it('totpSetup starts enrolment with an empty body', async () => {
    const http = mockFetch({ body: { secret: 'ABC', qrImageUrl: 'data:x' } });
    await expect(security.totpSetup()).resolves.toEqual({ secret: 'ABC', qrImageUrl: 'data:x' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/mfa/totp/setup`, body: {} });
  });

  it('totpVerify proves the first code', async () => {
    const http = mockFetch({ body: { enabled: true, method: 'totp' } });
    await expect(security.totpVerify('123456')).resolves.toEqual({ enabled: true, method: 'totp' });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${IAM}/mfa/totp/verify-setup`,
      body: { code: '123456' },
    });
  });

  it.each([1, 2] as const)('setMethod puts mfaType %i', async (mfaType) => {
    const http = mockFetch({ status: 204 });
    await expect(security.setMethod(mfaType)).resolves.toBeNull();
    expect(http.last()).toMatchObject({ method: 'PUT', url: `${IAM}/mfa/method`, body: { mfaType } });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { credentialModeLabel, inviteUrl, modeLabel, signupLinks, type GeneratedSignupLink } from './api';

const LINKS = 'https://blocksapi.example.com/iam/v4/iam/signup-links';

describe('modeLabel', () => {
  it.each([
    ['Embedded', 'Embedded'],
    [1, 'Embedded'],
    ['Oidc', 'OIDC'],
    [0, 'OIDC'],
  ] as const)('%j → %j', (mode, expected) => {
    expect(modeLabel(mode)).toBe(expected);
  });
});

describe('credentialModeLabel', () => {
  it.each([
    ['PasswordRequired', 'Password required'],
    [1, 'Password required'],
    ['Passwordless', 'Passwordless'],
    [0, 'Passwordless'],
  ] as const)('%j → %j', (mode, expected) => {
    expect(credentialModeLabel(mode)).toBe(expected);
  });
});

describe('inviteUrl', () => {
  const link: GeneratedSignupLink = { linkId: 'l1', code: 'abc+/=', expiresAtUtc: '2026-12-01T00:00:00Z', emailAlreadyExists: false };

  it('uses the URL IAM composed', () => {
    expect(inviteUrl({ ...link, url: 'https://iam.example.com/join#link=abc' })).toBe('https://iam.example.com/join#link=abc');
  });

  it.each([
    ['no URL', undefined],
    ['a null URL', null],
    ['an empty URL', ''],
  ])('falls back to the invitation page of this app for %s', (_case, url) => {
    vi.stubGlobal('location', { origin: 'https://app.example.com' });
    expect(inviteUrl({ ...link, url })).toBe('https://app.example.com/invitation#link=abc%2B%2F%3D');
  });
});

describe('signupLinks.configurations', () => {
  it('queries the first 100 active configurations', async () => {
    const list = { items: [{ itemId: 'cfg-1', name: 'Partners' }], totalCount: 1 };
    const http = mockFetch({ body: list });
    await expect(signupLinks.configurations()).resolves.toEqual(list);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${LINKS}/configurations/query` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 100, includeInactive: false });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('trims the search and passes paging and inactive ones through', async () => {
    const http = mockFetch();
    await signupLinks.configurations({ page: 1, pageSize: 10, includeInactive: true, search: '  partner ' });
    expect(http.last().body).toEqual({ page: 1, pageSize: 10, includeInactive: true, search: 'partner' });
  });

  it('leaves out a blank search', async () => {
    const http = mockFetch();
    await signupLinks.configurations({ search: '   ' });
    expect(http.last().body).toEqual({ page: 0, pageSize: 100, includeInactive: false });
  });
});

describe('signupLinks.generate', () => {
  it('posts the invitee to the signup-links root and returns the link', async () => {
    const generated = { linkId: 'l1', url: null, code: 'abc', expiresAtUtc: '2026-12-01T00:00:00Z', emailAlreadyExists: true };
    const http = mockFetch({ body: generated });
    const body = {
      configurationId: 'cfg-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      roles: ['member'],
      forwardedTo: '/welcome',
      expiresInMinutes: 60,
      maxRedemptions: 1,
    };
    await expect(signupLinks.generate(body)).resolves.toEqual(generated);
    expect(http.last()).toMatchObject({ method: 'POST', url: LINKS });
    expect(http.last().body).toEqual(body);
  });
});

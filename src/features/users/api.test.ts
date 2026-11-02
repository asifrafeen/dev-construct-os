import { describe, expect, it, vi } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { useAuthStore } from '@/state/auth-store';
import { mockFetch } from '@/test/mock-fetch';
import { users } from './api';

const IAM_BASE = 'https://blocksapi.example.com/iam/v4';
const IAM = `${IAM_BASE}/iam`;

describe('users.meOrNull', () => {
  it('returns the signed-in user from the data envelope', async () => {
    const http = mockFetch({ body: { data: { itemId: 'u1', email: 'ada@example.com' } } });
    await expect(users.meOrNull()).resolves.toEqual({ itemId: 'u1', email: 'ada@example.com' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/me`, body: undefined });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('renews once, and answers null when the session is really gone', async () => {
    const refresh = vi.spyOn(useAuthStore.getState(), 'refreshSession').mockResolvedValue(undefined);
    const http = mockFetch({ status: 401 });
    await expect(users.meOrNull()).resolves.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(http.requests).toHaveLength(2);
  });

  it('answers null when the renewal itself fails', async () => {
    vi.spyOn(useAuthStore.getState(), 'refreshSession').mockRejectedValue(new Error('refresh token expired'));
    const http = mockFetch({ status: 401 });
    await expect(users.meOrNull()).resolves.toBeNull();
    expect(http.requests).toHaveLength(1);
  });

  it('lets any other failure through', async () => {
    mockFetch({ status: 503, body: 'Service Unavailable' });
    await expect(users.meOrNull()).rejects.toMatchObject({ name: 'BlocksError', status: 503, body: 'Service Unavailable' });
  });
});

describe('users profile', () => {
  it('reads the raw me envelope', async () => {
    const http = mockFetch({ body: { data: { itemId: 'u1' } } });
    await expect(users.me()).resolves.toEqual({ data: { itemId: 'u1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/me` });
  });

  it('updates the own profile with a POST that carries the user id', async () => {
    const http = mockFetch();
    await users.updateMe('u1', { firstName: 'Ada', itemId: 'someone-else' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/me` });
    expect(http.last().body).toEqual({ firstName: 'Ada', itemId: 'u1' });
  });
});

describe('users admin routes', () => {
  it('lists with a POST from page 0 by 20', async () => {
    const http = mockFetch({ body: { totalCount: 1, data: [{ itemId: 'u1' }] } });
    await expect(users.list()).resolves.toEqual({ totalCount: 1, data: [{ itemId: 'u1' }] });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users`, body: { page: 0, pageSize: 20 } });

    await users.list({ page: 2, filter: { organizationIds: ['o1'] } });
    expect(http.last().body).toEqual({ page: 2, pageSize: 20, filter: { organizationIds: ['o1'] } });
  });

  it('reads one user, scoped to an organization when given', async () => {
    const http = mockFetch({ body: { data: { itemId: 'u1' } } });
    await expect(users.get('u1')).resolves.toEqual({ data: { itemId: 'u1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/users/u1` });

    await users.get('u1', 'o1');
    expect(http.last().url).toBe(`${IAM}/users/u1?organizationId=o1`);
  });

  it('creates a password user through the API', async () => {
    const http = mockFetch();
    await users.create({ email: 'ada@example.com', firstName: 'Ada' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/create` });
    expect(http.last().body).toEqual({ userPassType: 1, userCreationType: 2, email: 'ada@example.com', firstName: 'Ada' });
  });

  it('updates a user with its id forced into the body', async () => {
    const http = mockFetch();
    await users.update('u1', { lastName: 'Lovelace', itemId: 'u2' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/u1` });
    expect(http.last().body).toEqual({ lastName: 'Lovelace', itemId: 'u1' });
  });

  it('replaces roles and permissions, scoped to an organization when given', async () => {
    const http = mockFetch();
    await users.assign('u1', ['admin']);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/access` });
    expect(http.last().body).toEqual({ userId: 'u1', roles: ['admin'], permissions: [] });

    await users.assign('u1', ['admin'], ['read'], 'o1');
    expect(http.last().body).toEqual({ userId: 'u1', roles: ['admin'], permissions: ['read'], organizationId: 'o1' });

    await users.assign('u1', [], [], null);
    expect(http.last().body).toEqual({ userId: 'u1', roles: [], permissions: [] });
  });

  it('revokes all access, scoped to an organization when given', async () => {
    const http = mockFetch();
    await users.revokeAccess('u1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/revoke-access` });
    expect(http.last().body).toEqual({ userId: 'u1' });

    await users.revokeAccess('u1', 'o1');
    expect(http.last().body).toEqual({ userId: 'u1', organizationId: 'o1' });
  });

  it('deactivates, and reactivates with a reason', async () => {
    const http = mockFetch();
    await users.deactivate('u1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/deactivate`, body: { userId: 'u1' } });

    await users.activate('u1', 'Back from leave');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/activate`, body: { userId: 'u1', reason: 'Back from leave' } });
  });

  it('resends the activation mail through auth, with an optional purpose', async () => {
    const http = mockFetch({ body: { isSuccess: true, errors: null } });
    await expect(users.resendActivation('u1')).resolves.toEqual({ isSuccess: true, errors: null });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM_BASE}/auth/resend-activation` });
    expect(http.last().body).toEqual({ userId: 'u1' });

    await users.resendActivation('u1', 'invite');
    expect(http.last().body).toEqual({ userId: 'u1', mailPurpose: 'invite' });
  });

  it('checks whether an email exists with a POST body', async () => {
    const http = mockFetch({ body: { exists: true } });
    await expect(users.exists('ada@example.com')).resolves.toEqual({ exists: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/exists`, body: { email: 'ada@example.com' } });
  });

  it('changes roles in bulk, or previews the change', async () => {
    const http = mockFetch({ body: { affected: 3 } });
    const body = { organizationId: 'o1', addRoles: ['editor'], target: { userIds: ['u1', 'u2'] } };

    await expect(users.bulkRoles(body, false)).resolves.toEqual({ affected: 3 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/users/roles/bulk` });
    expect(http.last().body).toEqual({ addRoles: ['editor'], removeRoles: [], organizationId: 'o1', target: { userIds: ['u1', 'u2'] } });

    await users.bulkRoles({ target: { filter: { search: 'a' } } }, true);
    expect(http.last().url).toBe(`${IAM}/users/roles/bulk/preview`);
    expect(http.last().body).toEqual({ addRoles: [], removeRoles: [], target: { filter: { search: 'a' } } });
  });

  it('surfaces a refusal as a BlocksError', async () => {
    mockFetch({ status: 403, body: { error: 'forbidden' } });
    await expect(users.deactivate('u1')).rejects.toBeInstanceOf(BlocksError);
  });
});

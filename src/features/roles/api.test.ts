import { describe, expect, it } from 'vitest';
import { BlocksError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { roles, slugify } from './api';

const IAM = 'https://blocksapi.example.com/iam/v4/iam';

describe('slugify', () => {
  it.each([
    // case
    ['My Role Name', 'my_role_name'],
    ['Test role org', 'test_role_org'],
    ['ADMIN', 'admin'],
    ['MiXeD CaSe', 'mixed_case'],
    ['already_snake', 'already_snake'],
    ['Role 2', 'role_2'],
    // runs of punctuation and whitespace collapse to one underscore
    ['a -- b!!c', 'a_b_c'],
    ['Sales & Marketing / EMEA', 'sales_marketing_emea'],
    ['v1.2.3', 'v1_2_3'],
    ['a__b', 'a_b'],
    ['tab\tand\nnewline', 'tab_and_newline'],
    // leading and trailing separators are dropped
    ['  padded  ', 'padded'],
    ['__private__', 'private'],
    ['--Lead and trail!!', 'lead_and_trail'],
    ['_x_', 'x'],
    ['(Admin)', 'admin'],
    // nothing left
    ['', ''],
    ['   ', ''],
    ['___', ''],
    ['!@#$%^&*', ''],
    ['- _ -', ''],
    // unicode: anything outside a-z0-9 after lower-casing is a separator
    ['Café Owner', 'caf_owner'],
    ['Ünïcödé', 'n_c_d'],
    ['日本語', ''],
    ['日本 admin', 'admin'],
    ['Ops 🚀 Team', 'ops_team'],
    ['Kelvin', 'kelvin'],
  ])('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('handles a very long separator run in one pass', () => {
    const input = `${'_'.repeat(50_000)}Role${'!'.repeat(50_000)}Name${'_'.repeat(50_000)}`;
    expect(slugify(input)).toBe('role_name');
  });
});

describe('roles.list', () => {
  it('posts an empty search and no slugs or organization by default', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'r1', slug: 'admin' }], totalCount: 1 } });
    const page = await roles.list();

    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/roles` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 20, filter: { search: '' } });
    expect(http.last().headers).toMatchObject({ 'x-blocks-key': 'test-project-key', 'Content-Type': 'application/json' });
    expect(page).toEqual({ data: [{ itemId: 'r1', slug: 'admin' }], totalCount: 1 });
  });

  it('trims the search and puts the organization at the root, not in the filter', async () => {
    const http = mockFetch();
    await roles.list({ organizationId: 'org-1', search: '  adm ', slugs: ['admin', 'owner'], page: 2, pageSize: 5 });
    expect(http.last().body).toEqual({
      page: 2,
      pageSize: 5,
      filter: { search: 'adm', slugs: ['admin', 'owner'] },
      organizationId: 'org-1',
    });
  });

  it('leaves out an empty slug list and a null organization', async () => {
    const http = mockFetch();
    await roles.list({ organizationId: null, slugs: [] });
    expect(http.last().body).toEqual({ page: 0, pageSize: 20, filter: { search: '' } });
  });
});

describe('roles single-role routes', () => {
  it('reads one role by id', async () => {
    const http = mockFetch({ body: { data: { itemId: 'r1', name: 'Admin' } } });
    await expect(roles.get('r1')).resolves.toEqual({ data: { itemId: 'r1', name: 'Admin' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/roles/r1`, body: undefined });
  });

  it('refuses to revoke from users unless the caller opts in', async () => {
    const http = mockFetch();
    await roles.remove('r1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${IAM}/roles/r1?confirmRevokeFromUsers=false` });

    await roles.remove('r1', true);
    expect(http.last().url).toBe(`${IAM}/roles/r1?confirmRevokeFromUsers=true`);
  });

  it('reads the archive impact', async () => {
    const http = mockFetch({ body: { affectedUsers: 3 } });
    await expect(roles.archiveImpact('r1')).resolves.toEqual({ affectedUsers: 3 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/roles/r1/archive-impact` });
  });

  it('reads the roles the signed-in admin may grant', async () => {
    const http = mockFetch({ body: { hierarchy: [{ slug: 'admin' }], standalone: null } });
    await expect(roles.assignable()).resolves.toEqual({ hierarchy: [{ slug: 'admin' }], standalone: null });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/roles/assignable` });
  });
});

describe('roles.create', () => {
  it('derives the slug from the name when none is given', async () => {
    const http = mockFetch();
    await roles.create({ name: 'Sales Lead' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/roles/create` });
    expect(http.last().body).toEqual({ name: 'Sales Lead', slug: 'sales_lead', canCreateOwn: false });
  });

  it('uses a given slug, trimmed', async () => {
    const http = mockFetch();
    await roles.create({ name: 'Sales Lead', slug: '  leads  ' });
    expect(http.last().body).toMatchObject({ slug: 'leads' });
  });

  it('falls back to the derived slug when the given one is blank', async () => {
    const http = mockFetch();
    await roles.create({ name: 'Sales Lead', slug: '   ' });
    expect(http.last().body).toMatchObject({ slug: 'sales_lead' });
  });

  it('passes the other fields through, overriding the canCreateOwn default', async () => {
    const http = mockFetch();
    await roles.create({
      name: 'Lead',
      description: 'Leads',
      parentRoleSlug: 'member',
      canCreateOwn: true,
      confirmDuplicateName: true,
    });
    expect(http.last().body).toEqual({
      name: 'Lead',
      slug: 'lead',
      canCreateOwn: true,
      description: 'Leads',
      parentRoleSlug: 'member',
      confirmDuplicateName: true,
    });
  });

  it('surfaces a refusal as a BlocksError with the server body', async () => {
    mockFetch({ status: 400, body: { errors: { name: 'duplicate' } } });
    const error: unknown = await roles.create({ name: 'Admin' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlocksError);
    expect(error).toMatchObject({ status: 400, url: `${IAM}/roles/create`, body: { errors: { name: 'duplicate' } } });
  });
});

describe('roles.update', () => {
  it('posts to the fixed update path with the id in the body and safe defaults', async () => {
    const http = mockFetch();
    await roles.update({ itemId: 'r1', name: 'Renamed' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/roles/update` });
    expect(http.last().body).toEqual({ propagateToOtherOrg: false, canCreateOwn: false, itemId: 'r1', name: 'Renamed' });
  });

  it('lets the caller propagate and allow own creation', async () => {
    const http = mockFetch();
    await roles.update({ itemId: 'r1', propagateToOtherOrg: true, canCreateOwn: true });
    expect(http.last().body).toEqual({ propagateToOtherOrg: true, canCreateOwn: true, itemId: 'r1' });
  });
});

describe('roles.setPermissions', () => {
  it('sends empty add and remove lists and no propagation by default', async () => {
    const http = mockFetch();
    await roles.setPermissions({ slug: 'admin' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/roles/assign-permissions` });
    expect(http.last().body).toEqual({ propagateToAllOrganizations: false, addPermissions: [], removePermissions: [], slug: 'admin' });
  });

  it('passes the caller changes through', async () => {
    const http = mockFetch();
    await roles.setPermissions({
      slug: 'admin',
      addPermissions: ['read'],
      removePermissions: ['write'],
      organizationId: 'org-1',
      propagateToAllOrganizations: true,
    });
    expect(http.last().body).toEqual({
      propagateToAllOrganizations: true,
      addPermissions: ['read'],
      removePermissions: ['write'],
      slug: 'admin',
      organizationId: 'org-1',
    });
  });
});

describe('roles.permissions', () => {
  it('pages 200 unarchived permissions by default', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'p1' }], totalCount: 1 } });
    await expect(roles.permissions()).resolves.toEqual({ data: [{ itemId: 'p1' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/permissions` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 200, filter: { search: '', isArchived: false } });
  });

  it('filters by roles and organization at the root', async () => {
    const http = mockFetch();
    await roles.permissions({ organizationId: 'org-1', roles: ['admin'], search: ' read ', page: 1, pageSize: 10 });
    expect(http.last().body).toEqual({
      page: 1,
      pageSize: 10,
      filter: { search: 'read', isArchived: false },
      roles: ['admin'],
      organizationId: 'org-1',
    });
  });

  it('leaves out an empty role list and a null organization', async () => {
    const http = mockFetch();
    await roles.permissions({ organizationId: null, roles: [] });
    expect(http.last().body).toEqual({ page: 0, pageSize: 200, filter: { search: '', isArchived: false } });
  });
});

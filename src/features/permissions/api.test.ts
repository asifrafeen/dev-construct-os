import { describe, expect, it } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { permissions } from './api';

const IAM = 'https://blocksapi.example.com/iam/v4/iam';

describe('permissions.list', () => {
  it('posts an empty search over unarchived permissions, from page 0 by 20', async () => {
    const http = mockFetch({ body: { data: [{ itemId: 'p1', name: 'read' }], totalCount: 1 } });
    await expect(permissions.list()).resolves.toEqual({ data: [{ itemId: 'p1', name: 'read' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/permissions` });
    expect(http.last().body).toEqual({ page: 0, pageSize: 20, filter: { search: '', isArchived: false } });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('merges the caller filter over the defaults and scopes by role and organization', async () => {
    const http = mockFetch();
    await permissions.list({
      page: 1,
      pageSize: 50,
      filter: { search: 'file', isArchived: true, isBuiltIn: 'no', resourceGroup: 'data', tags: ['t'], resources: ['r'] },
      roles: ['admin'],
      organizationId: 'org-1',
    });
    expect(http.last().body).toEqual({
      page: 1,
      pageSize: 50,
      filter: { search: 'file', isArchived: true, isBuiltIn: 'no', resourceGroup: 'data', tags: ['t'], resources: ['r'] },
      roles: ['admin'],
      organizationId: 'org-1',
    });
  });

  it('leaves out an empty role list and a null organization', async () => {
    const http = mockFetch();
    await permissions.list({ roles: [], organizationId: null });
    expect(http.last().body).toEqual({ page: 0, pageSize: 20, filter: { search: '', isArchived: false } });
  });
});

describe('permissions by id', () => {
  it('reads one permission, encoding the id', async () => {
    const http = mockFetch({ body: { data: { itemId: 'p 1' } } });
    await expect(permissions.get('p 1')).resolves.toEqual({ data: { itemId: 'p 1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/permissions/p%201`, body: undefined });
  });

  it('creates a custom feature permission unless told otherwise', async () => {
    const http = mockFetch({ body: { isSuccess: true, itemId: 'p1' } });
    await expect(permissions.create({ name: 'read', resource: 'files' })).resolves.toEqual({ isSuccess: true, itemId: 'p1' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/permissions/create` });
    expect(http.last().body).toEqual({ type: 1, tags: [], dependentPermissions: [], isBuiltIn: false, name: 'read', resource: 'files' });

    await permissions.create({ name: 'write', resource: 'files', type: 3, tags: ['core'], isBuiltIn: true });
    expect(http.last().body).toMatchObject({ type: 3, tags: ['core'], isBuiltIn: true });
  });

  it('updates with the id forced into the body', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await permissions.update('p/1', { name: 'read', resource: 'files', isArchived: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/permissions/p%2F1` });
    expect(http.last().body).toEqual({ name: 'read', resource: 'files', isArchived: true, itemId: 'p/1' });
  });

  it('refuses to revoke from users unless the caller opts in', async () => {
    const http = mockFetch();
    await permissions.remove('p1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${IAM}/permissions/p1?confirmRevokeFromUsers=false` });

    await permissions.remove('p1', true);
    expect(http.last().url).toBe(`${IAM}/permissions/p1?confirmRevokeFromUsers=true`);
  });

  it('reads the archive impact', async () => {
    const http = mockFetch({ body: { roles: 2 } });
    await expect(permissions.archiveImpact('p1')).resolves.toEqual({ roles: 2 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/permissions/p1/archive-impact` });
  });
});

describe('permission catalogues', () => {
  it('reads permissions by severity and the resource groups', async () => {
    const http = mockFetch({ body: [] });
    await expect(permissions.bySeverity()).resolves.toEqual([]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/permissions/by-severity` });

    await permissions.resourceGroups();
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/resource-groups` });
  });

  it('reads the feature catalogue, with an encoded search when given', async () => {
    const http = mockFetch({ body: [{ resource: 'files', name: 'Files' }] });
    await expect(permissions.features()).resolves.toEqual([{ resource: 'files', name: 'Files' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${IAM}/resource/features` });

    await permissions.features('a b&c');
    expect(http.last().url).toBe(`${IAM}/resource/features?search=a%20b%26c`);

    await permissions.features('');
    expect(http.last().url).toBe(`${IAM}/resource/features`);
  });

  it('previews a role permission change with empty lists by default', async () => {
    const http = mockFetch({ body: { affectedUsers: 4 } });
    await expect(permissions.roleChangeImpact({ slug: 'admin' })).resolves.toEqual({ affectedUsers: 4 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${IAM}/roles/permission-change-impact` });
    expect(http.last().body).toEqual({ addPermissions: [], removePermissions: [], slug: 'admin' });

    await permissions.roleChangeImpact({ slug: 'admin', addPermissions: ['read'], organizationId: 'org-1' });
    expect(http.last().body).toEqual({ addPermissions: ['read'], removePermissions: [], slug: 'admin', organizationId: 'org-1' });
  });
});

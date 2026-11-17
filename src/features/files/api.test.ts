import { describe, expect, it } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { MODULES, directories, files, objects } from './api';

const DATA = 'https://blocksapi.example.com/data/v4';
const FILES = `${DATA}/files`;
const DIRS = `${DATA}/directory`;
const OBJECTS = `${DATA}/objects`;

describe('files.presign', () => {
  it('posts the server defaults with the project key and an empty-string parent', async () => {
    const http = mockFetch({ body: { uploadUrl: 'https://storage.example.net/put', fileId: 'f1' } });
    const res = await files.presign({ name: 'report.pdf' });

    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/get-pre-signed-url-for-upload` });
    expect(http.last().body).toEqual({
      projectKey: 'test-project-key',
      accessModifier: 'Private',
      configurationName: 'Default',
      moduleName: MODULES.Default_Cloud,
      parentDirectoryId: '',
      tags: '',
      metaData: '{}',
      inheritsParentAccess: true,
      name: 'report.pdf',
    });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
    expect(res).toEqual({ uploadUrl: 'https://storage.example.net/put', fileId: 'f1' });
  });

  it('lets the caller override every default', async () => {
    const http = mockFetch();
    await files.presign({
      name: 'v2.pdf',
      accessModifier: 'Public',
      parentDirectoryId: 'dir-1',
      moduleName: MODULES.Default_Construct,
      itemId: 'f1',
      sizeInBytes: 42,
      contentType: 'application/pdf',
    });
    expect(http.last().body).toMatchObject({
      accessModifier: 'Public',
      parentDirectoryId: 'dir-1',
      moduleName: 8,
      itemId: 'f1',
      sizeInBytes: 42,
      contentType: 'application/pdf',
    });
  });
});

describe('files', () => {
  it('confirms an upload with the file and version ids', async () => {
    const http = mockFetch({ body: { verificationStatus: 'Verified' } });
    await expect(files.completeUpload('f1', 'v1')).resolves.toEqual({ verificationStatus: 'Verified' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/complete-upload`, body: { fileId: 'f1', fileVersionId: 'v1' } });
  });

  it('reads one file with the Default configuration unless told otherwise', async () => {
    const http = mockFetch({ body: { fileId: 'f1', name: 'a.txt' } });
    await expect(files.get('f1')).resolves.toEqual({ fileId: 'f1', name: 'a.txt' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${FILES}/get-file?FileId=f1&ConfigurationName=Default`, body: undefined });

    await files.get('f1', { version: 2, configurationName: 'Archive' });
    expect(http.last().url).toBe(`${FILES}/get-file?FileId=f1&Version=2&ConfigurationName=Archive`);
  });

  it('reads many files in one POST', async () => {
    const http = mockFetch({ body: [] });
    await files.getMany(['a', 'b']);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/get-files`, body: { fileIds: ['a', 'b'], configurationName: 'Default' } });

    await files.getMany(['a'], 'Archive');
    expect(http.last().body).toEqual({ fileIds: ['a'], configurationName: 'Archive' });
  });

  it('pages file info from 0 by 20 by default', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await files.info({});
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/get-files-info`, body: { page: 0, pageSize: 20 } });

    await files.info({ page: 3, filter: { name: 'x' }, sort: { property: 'CreatedDate', isDescending: true } });
    expect(http.last().body).toEqual({
      page: 3,
      pageSize: 20,
      filter: { name: 'x' },
      sort: { property: 'CreatedDate', isDescending: true },
    });
  });

  it('always sends permanent explicitly, defaulting to a move to trash', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await files.del('f1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/delete-file`, body: { fileId: 'f1', permanent: false } });

    await files.del('f1', true);
    expect(http.last().body).toEqual({ fileId: 'f1', permanent: true });
  });

  it('renames, moves and copies', async () => {
    const http = mockFetch({ body: { fileId: 'f1' } });

    await files.rename('f1', 'b.txt');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/rename-file`, body: { fileId: 'f1', name: 'b.txt' } });

    await files.move('f1', 'dir-2');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/move-file`, body: { fileId: 'f1', targetDirectoryId: 'dir-2' } });

    await files.copy('f1', 'dir-2');
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${FILES}/copy-file`,
      body: { fileId: 'f1', targetDirectoryId: 'dir-2', copyAccessPolicies: false },
    });

    await files.copy('f1', 'dir-2', true);
    expect(http.last().body).toEqual({ fileId: 'f1', targetDirectoryId: 'dir-2', copyAccessPolicies: true });
  });

  it('lists versions 25 at a time, with an optional cursor', async () => {
    const http = mockFetch({ body: { items: [{ itemId: 'v1', no: 1 }], hasMore: false } });
    await expect(files.versions('f1')).resolves.toEqual({ items: [{ itemId: 'v1', no: 1 }], hasMore: false });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${FILES}/get-file-versions?FileId=f1&Limit=25` });

    await files.versions('f1', 'cur-9', 10);
    expect(http.last().url).toBe(`${FILES}/get-file-versions?FileId=f1&Cursor=cur-9&Limit=10`);
  });

  it('starts a new version', async () => {
    const http = mockFetch({ body: { versionNo: 2, uploadUrl: 'https://storage.example.net/v2' } });
    await expect(files.createVersion('f1')).resolves.toMatchObject({ versionNo: 2 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${FILES}/create-file-version`, body: { fileId: 'f1', configurationName: 'Default' } });

    await files.createVersion('f1', 'Archive');
    expect(http.last().body).toEqual({ fileId: 'f1', configurationName: 'Archive' });
  });

  it('updates additional properties without touching the access level', async () => {
    const http = mockFetch();
    await files.updateAdditionalInfo('f1', { owner: 'ada' });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${FILES}/update-file-additional-info`,
      body: { itemId: 'f1', additionalProperties: { owner: 'ada' }, updateObjectAccessLevel: false },
    });
  });
});

describe('directories', () => {
  it('falls back to the default module when there is no parent', async () => {
    const http = mockFetch({ body: { directoryId: 'd1' } });
    await expect(directories.create({ name: 'Docs' })).resolves.toEqual({ directoryId: 'd1' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${DIRS}/create-directory` });
    expect(http.last().body).toEqual({ inheritsParentAccess: true, moduleName: MODULES.Default_Cloud, name: 'Docs' });
  });

  it('leaves the module out when a parent is given', async () => {
    const http = mockFetch();
    await directories.create({ name: 'Docs', parentDirectoryId: 'p1' });
    expect(http.last().body).toEqual({ inheritsParentAccess: true, name: 'Docs', parentDirectoryId: 'p1' });
  });

  it('keeps an explicit module over the default', async () => {
    const http = mockFetch();
    await directories.create({ name: 'Docs', moduleName: MODULES.OS_Construct, allowedFileExtensions: ['pdf'] });
    expect(http.last().body).toEqual({ inheritsParentAccess: true, moduleName: 10, name: 'Docs', allowedFileExtensions: ['pdf'] });
  });

  it('reads one directory', async () => {
    const http = mockFetch({ body: { itemId: 'd1', name: 'Docs' } });
    await expect(directories.get('d1')).resolves.toEqual({ itemId: 'd1', name: 'Docs' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${DIRS}/get-directory?directoryId=d1` });
  });

  it('updates without touching the access level', async () => {
    const http = mockFetch();
    await directories.update('d1', { name: 'New', description: 'Notes' });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${DIRS}/update-directory`,
      body: { directoryId: 'd1', name: 'New', description: 'Notes', updateObjectAccessLevel: false },
    });
  });

  it('deletes to trash unless told to delete permanently', async () => {
    const http = mockFetch();
    await directories.del('d1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${DIRS}/delete-directory`, body: { directoryId: 'd1', permanent: false } });

    await directories.del('d1', true);
    expect(http.last().body).toEqual({ directoryId: 'd1', permanent: true });
  });

  it('moves to the root when no target is given', async () => {
    const http = mockFetch();
    await directories.move('d1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${DIRS}/move-directory` });
    expect(http.last().body).toEqual({ directoryId: 'd1' });

    await directories.move('d1', 'd2');
    expect(http.last().body).toEqual({ directoryId: 'd1', targetDirectoryId: 'd2' });
  });
});

describe('objects', () => {
  it('lists 50 children by default and drops unset filters', async () => {
    const page = { items: [{ itemId: 'o1', name: 'a', type: 'file' }], hasMore: false };
    const http = mockFetch({ body: page });
    await expect(objects.list()).resolves.toEqual(page);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OBJECTS}/get-objects?Limit=50` });

    await objects.list({ search: '' });
    expect(http.last().url).toBe(`${OBJECTS}/get-objects?Limit=50`);
  });

  it('sends every list filter in PascalCase', async () => {
    const http = mockFetch();
    await objects.list({ parentDirectoryId: 'p1', moduleName: 3, cursor: 'c1', limit: 10, type: 'file', search: 'q 1' });
    expect(http.last().url).toBe(`${OBJECTS}/get-objects?ParentDirectoryId=p1&ModuleName=3&Cursor=c1&Limit=10&Type=file&Search=q+1`);
  });

  it('searches by query', async () => {
    const http = mockFetch();
    await objects.search('report');
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OBJECTS}/search-objects?Query=report&Limit=50` });

    await objects.search('report', { directoryId: 'd1', cursor: 'c1', limit: 5, type: 'directory' });
    expect(http.last().url).toBe(`${OBJECTS}/search-objects?Query=report&DirectoryId=d1&Cursor=c1&Limit=5&Type=directory`);
  });

  it('pages the trash and the shared list', async () => {
    const http = mockFetch();
    await objects.trash();
    expect(http.last().url).toBe(`${OBJECTS}/get-trash?Limit=50`);
    await objects.trash('c2');
    expect(http.last().url).toBe(`${OBJECTS}/get-trash?Cursor=c2&Limit=50`);

    await objects.shared();
    expect(http.last().url).toBe(`${OBJECTS}/get-shared-objects?Limit=50`);
    await objects.shared('c3');
    expect(http.last().url).toBe(`${OBJECTS}/get-shared-objects?Cursor=c3&Limit=50`);
  });

  it('restores and purges trash items by resource id', async () => {
    const http = mockFetch({ body: { resourceId: 'r1' } });
    await objects.restore('r1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/restore-from-trash`, body: { resourceId: 'r1' } });

    await objects.deleteForever('r1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/delete-from-trash`, body: { resourceId: 'r1' } });
  });

  it('reads access policies, inherited ones included by default', async () => {
    const http = mockFetch({ body: [{ itemId: 'p1' }] });
    await expect(objects.policies('r1')).resolves.toEqual([{ itemId: 'p1' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OBJECTS}/get-access-policies?ResourceId=r1&IncludeInherited=true` });

    await objects.policies('r1', false);
    expect(http.last().url).toBe(`${OBJECTS}/get-access-policies?ResourceId=r1&IncludeInherited=false`);
  });

  it('grants as an Allow at priority 0 unless told otherwise', async () => {
    const http = mockFetch({ body: { itemId: 'pol-1' } });
    const input = { resourceId: 'r1', resourceType: 'File', principalType: 'User', principalId: 'u1', permission: 'View' } as const;

    await expect(objects.grant(input)).resolves.toEqual({ itemId: 'pol-1' });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/grant-access` });
    expect(http.last().body).toEqual({ effect: 'Allow', priority: 0, ...input });

    await objects.grant({ ...input, effect: 'Deny', priority: 5 });
    expect(http.last().body).toMatchObject({ effect: 'Deny', priority: 5 });
  });

  it('revokes one policy', async () => {
    const http = mockFetch();
    await objects.revoke('r1', 'pol-1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/revoke-access-policy`, body: { resourceId: 'r1', policyItemId: 'pol-1' } });
  });

  it('resolves the effective permissions of the caller', async () => {
    const perms = { canView: true, canDownload: true, canEdit: false, canDelete: false, canManage: false, canOwner: false };
    const http = mockFetch({ body: perms });
    await expect(objects.resolve('r1')).resolves.toEqual(perms);
    expect(http.last()).toMatchObject({ method: 'GET', url: `${OBJECTS}/resolve-access?resourceId=r1` });
  });

  it('toggles inheritance', async () => {
    const http = mockFetch();
    await objects.toggleInheritance('r1', false);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/toggle-inheritance`, body: { resourceId: 'r1', inheritsParentAccess: false } });
  });

  it('shares with exactly the input it was given', async () => {
    const http = mockFetch();
    const input = { resourceId: 'r1', resourceType: 'Directory', principalType: 'Everyone', permission: 'Download' } as const;
    await objects.share(input);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${OBJECTS}/share-object` });
    expect(http.last().body).toEqual(input);
  });
});

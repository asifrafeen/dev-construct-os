import { BLOCKS, DATA_BASE } from '@/lib/env';
import { blocksFetch } from '@/lib/blocks-client';

/**
 * DMS / file storage — files, their versions, the directory tree, and the object-level
 * sharing and access policies on top.
 *
 * Uploads are two (sometimes three) steps: presign, a binary PUT straight to the storage
 * provider, and — when the presign says so — `complete-upload` to tell DMS the bytes
 * landed. There is no `/Files/UploadFile`.
 *
 * Route casing: every Files action answers on both `Files/GetFile` and `files/get-file`.
 * Directory and objects routes exist only in kebab-case. Responses are flat, with no
 * `{ isSuccess, data }` envelope, and errors on the newer routes are `{ message }`.
 *
 * Every endpoint is permission-gated (`blocks-data::file|directory|object::*`): a project
 * user only gets through if the project granted their role those resources.
 */

const FILES = `${DATA_BASE}/files`;
const DIRS = `${DATA_BASE}/directory`;
const OBJECTS = `${DATA_BASE}/objects`;

/**
 * Which module's default directory a root-level upload lands in. Numeric — the server has
 * no string converter for this enum. 3 is what this app has always sent; 8 is the
 * server's own default and the construct-side one.
 */
export const MODULES = {
  Cloud: 1,
  Construct: 2,
  Default_Cloud: 3,
  AI_Cloud: 4,
  OS_Cloud: 5,
  Localization: 6,
  LMT: 7,
  Default_Construct: 8,
  AI_Construct: 9,
  OS_Construct: 10,
  DataGateway: 11,
} as const;

export type AccessModifier = 'Private' | 'Public' | 'Secure' | 'Any';

export interface PresignInput {
  name: string;
  parentDirectoryId?: string;
  accessModifier?: AccessModifier;
  configurationName?: string;
  moduleName?: number;
  tags?: string;
  metaData?: string;
  additionalProperties?: Record<string, string>;
  sizeInBytes?: number;
  contentType?: string;
  /** Overwrite this file id (new version) instead of creating one. */
  itemId?: string;
}

export interface PresignResponse {
  uploadUrl?: string;
  fileId?: string;
  fileVersionId?: string;
  uploadSessionId?: string;
  uploadUrlExpiresAtUtc?: string;
  /** Headers the storage provider requires on the PUT — send every one. */
  requiredHeaders?: Record<string, string>;
  /** When true, the upload is not visible until `complete-upload` confirms it. */
  uploadCompletionRequired?: boolean;
  verificationStatus?: string;
  isSuccess?: boolean;
  errors?: unknown;
}

export interface FileRecord {
  fileId?: string;
  itemId?: string;
  name?: string;
  url?: string;
  sizeInBytes?: number;
  currentVersion?: number;
  /** 0 Private, 1 Public, 2 Secure, 3 Any — numeric on the way out. */
  accessModifier?: number;
  tags?: string[];
  metaData?: Record<string, { type?: string; value?: string }>;
  parentDirectoryID?: string;
  typeString?: string;
  verificationStatus?: string;
  downloadUrlExpiresAtUtc?: string;
  createdDate?: string;
  createdBy?: string;
  additionalProperties?: Record<string, string>;
  [k: string]: unknown;
}

export type ObjectType = 'file' | 'directory';

export interface StorageObject {
  itemId: string;
  name: string;
  type: ObjectType;
  parentDirectoryId?: string;
  sizeInBytes?: number;
  createdDate?: string;
  lastUpdatedDate?: string;
  createdBy?: string;
  extension?: string;
  contentType?: string;
  isDefault?: boolean;
  permissions?: Permissions;
}

export interface Permissions {
  canView: boolean;
  canDownload: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManage: boolean;
  canOwner: boolean;
}

export interface ObjectPage {
  items: StorageObject[];
  nextCursor?: string | null;
  totalChildCount?: number;
  hasMore?: boolean;
}

export interface DirectoryRecord {
  itemId: string;
  name: string;
  parentDirectoryId?: string;
  description?: string;
  fullPath?: string;
  ancestorIds?: string[];
  inheritsParentAccess?: boolean;
  childDirectoryCount?: number;
  childFileCount?: number;
  sizeInBytes?: number;
  allowedFileExtensions?: string[];
  objectAccessLevel?: string;
  permissions?: Permissions;
  createdDate?: string;
}

export type PrincipalType = 'User' | 'Role' | 'Everyone' | 'Organization';
export type StoragePermission = 'View' | 'Download' | 'Edit' | 'Delete' | 'Manage' | 'Owner';

export interface AccessPolicy {
  itemId: string;
  resourceId: string;
  resourceType: string | number;
  principalType: string | number;
  principalId?: string;
  organizationId?: string;
  permission: string | number;
  effect: string | number;
  priority?: number;
  expiresAt?: string;
  grantedBy?: string;
  createdDate?: string;
}

export interface PolicyInput {
  resourceId: string;
  resourceType: 'File' | 'Directory';
  principalType: PrincipalType;
  principalId?: string;
  organizationId?: string;
  permission: StoragePermission;
  effect?: 'Allow' | 'Deny';
  priority?: number;
  expiresAt?: string;
  policyItemId?: string;
}

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString();
}

export const files = {
  presign: (input: PresignInput) =>
    blocksFetch<PresignResponse>(`${FILES}/get-pre-signed-url-for-upload`, {
      method: 'POST',
      // parentDirectoryId must be a string ("" = the module's default directory), never null.
      body: {
        projectKey: BLOCKS.projectKey,
        accessModifier: 'Private',
        configurationName: 'Default',
        moduleName: MODULES.Default_Cloud,
        parentDirectoryId: '',
        tags: '',
        metaData: '{}',
        inheritsParentAccess: true,
        ...input,
      },
    }),

  completeUpload: (fileId: string, fileVersionId: string) =>
    blocksFetch<{ verificationStatus?: string; rejectionReason?: string; isSuccess?: boolean }>(
      `${FILES}/complete-upload`,
      { method: 'POST', body: { fileId, fileVersionId } },
    ),

  get: (fileId: string, opts: { version?: number; configurationName?: string } = {}) =>
    blocksFetch<FileRecord>(
      `${FILES}/get-file?${qs({ FileId: fileId, Version: opts.version, ConfigurationName: opts.configurationName ?? 'Default' })}`,
    ),

  getMany: (fileIds: string[], configurationName = 'Default') =>
    blocksFetch<FileRecord[]>(`${FILES}/get-files`, { method: 'POST', body: { fileIds, configurationName } }),

  info: (body: { page?: number; pageSize?: number; filter?: Record<string, unknown>; sort?: { property: string; isDescending: boolean } }) =>
    blocksFetch<{ data?: FileRecord[]; totalCount?: number; errors?: unknown }>(`${FILES}/get-files-info`, {
      method: 'POST',
      body: { page: 0, pageSize: 20, ...body },
    }),

  /**
   * `permanent` defaults to TRUE on the server, so it is always sent explicitly here —
   * the safe reading of "delete" is "move to trash".
   */
  del: (fileId: string, permanent = false) =>
    blocksFetch<{ isSuccess?: boolean }>(`${FILES}/delete-file`, {
      method: 'POST',
      body: { fileId, permanent },
    }),

  rename: (fileId: string, name: string) =>
    blocksFetch<{ fileId: string }>(`${FILES}/rename-file`, { method: 'POST', body: { fileId, name } }),

  move: (fileId: string, targetDirectoryId: string) =>
    blocksFetch<{ fileId: string }>(`${FILES}/move-file`, { method: 'POST', body: { fileId, targetDirectoryId } }),

  copy: (fileId: string, targetDirectoryId: string, copyAccessPolicies = false) =>
    blocksFetch<{ fileId: string }>(`${FILES}/copy-file`, {
      method: 'POST',
      body: { fileId, targetDirectoryId, copyAccessPolicies },
    }),

  versions: (fileId: string, cursor?: string, limit = 25) =>
    blocksFetch<{
      items?: { itemId: string; no: number; sizeInBytes?: number; uploadedBy?: string; createdDate?: string }[];
      nextCursor?: string;
      hasMore?: boolean;
    }>(`${FILES}/get-file-versions?${qs({ FileId: fileId, Cursor: cursor, Limit: limit })}`),

  /** Starts a new version and returns an upload URL for its bytes. */
  createVersion: (fileId: string, configurationName = 'Default') =>
    blocksFetch<{ versionNo?: number; uploadUrl?: string; fileVersionId?: string; requiredHeaders?: Record<string, string>; uploadCompletionRequired?: boolean }>(
      `${FILES}/create-file-version`,
      { method: 'POST', body: { fileId, configurationName } },
    ),

  updateAdditionalInfo: (itemId: string, additionalProperties: Record<string, string>) =>
    blocksFetch<unknown>(`${FILES}/update-file-additional-info`, {
      method: 'POST',
      body: { itemId, additionalProperties, updateObjectAccessLevel: false },
    }),
};

export const directories = {
  create: (input: { name: string; parentDirectoryId?: string; description?: string; moduleName?: number; allowedFileExtensions?: string[] }) =>
    blocksFetch<{ directoryId: string }>(`${DIRS}/create-directory`, {
      method: 'POST',
      // Without a parent, the module decides where it goes — and with neither, 400.
      body: { inheritsParentAccess: true, ...(input.parentDirectoryId ? {} : { moduleName: MODULES.Default_Cloud }), ...input },
    }),

  get: (directoryId: string) => blocksFetch<DirectoryRecord>(`${DIRS}/get-directory?${qs({ directoryId })}`),

  update: (directoryId: string, patch: { name?: string; description?: string }) =>
    blocksFetch<{ directoryId: string }>(`${DIRS}/update-directory`, {
      method: 'POST',
      body: { directoryId, ...patch, updateObjectAccessLevel: false },
    }),

  /** Server default is permanent=true, and a non-empty permanent delete is a 409. */
  del: (directoryId: string, permanent = false) =>
    blocksFetch<{ directoryId: string }>(`${DIRS}/delete-directory`, { method: 'POST', body: { directoryId, permanent } }),

  move: (directoryId: string, targetDirectoryId?: string) =>
    blocksFetch<{ directoryId: string }>(`${DIRS}/move-directory`, {
      method: 'POST',
      body: { directoryId, ...(targetDirectoryId ? { targetDirectoryId } : {}) },
    }),
};

export const objects = {
  list: (p: { parentDirectoryId?: string; moduleName?: number; cursor?: string; limit?: number; type?: ObjectType; search?: string } = {}) =>
    blocksFetch<ObjectPage>(
      `${OBJECTS}/get-objects?${qs({ ParentDirectoryId: p.parentDirectoryId, ModuleName: p.moduleName, Cursor: p.cursor, Limit: p.limit ?? 50, Type: p.type, Search: p.search })}`,
    ),
  search: (query: string, p: { directoryId?: string; cursor?: string; limit?: number; type?: ObjectType } = {}) =>
    blocksFetch<ObjectPage>(
      `${OBJECTS}/search-objects?${qs({ Query: query, DirectoryId: p.directoryId, Cursor: p.cursor, Limit: p.limit ?? 50, Type: p.type })}`,
    ),
  trash: (cursor?: string) => blocksFetch<ObjectPage>(`${OBJECTS}/get-trash?${qs({ Cursor: cursor, Limit: 50 })}`),
  shared: (cursor?: string) => blocksFetch<ObjectPage>(`${OBJECTS}/get-shared-objects?${qs({ Cursor: cursor, Limit: 50 })}`),
  restore: (resourceId: string) =>
    blocksFetch<{ resourceId: string }>(`${OBJECTS}/restore-from-trash`, { method: 'POST', body: { resourceId } }),
  deleteForever: (resourceId: string) =>
    blocksFetch<{ resourceId: string }>(`${OBJECTS}/delete-from-trash`, { method: 'POST', body: { resourceId } }),

  policies: (resourceId: string, includeInherited = true) =>
    blocksFetch<AccessPolicy[]>(`${OBJECTS}/get-access-policies?${qs({ ResourceId: resourceId, IncludeInherited: includeInherited })}`),
  grant: (input: PolicyInput) =>
    blocksFetch<{ itemId: string }>(`${OBJECTS}/grant-access`, {
      method: 'POST',
      body: { effect: 'Allow', priority: 0, ...input },
    }),
  revoke: (resourceId: string, policyItemId: string) =>
    blocksFetch<unknown>(`${OBJECTS}/revoke-access-policy`, { method: 'POST', body: { resourceId, policyItemId } }),
  resolve: (resourceId: string) => blocksFetch<Permissions>(`${OBJECTS}/resolve-access?${qs({ resourceId })}`),
  toggleInheritance: (resourceId: string, inheritsParentAccess: boolean) =>
    blocksFetch<unknown>(`${OBJECTS}/toggle-inheritance`, { method: 'POST', body: { resourceId, inheritsParentAccess } }),
  share: (input: Omit<PolicyInput, 'effect' | 'priority' | 'policyItemId'>) =>
    blocksFetch<unknown>(`${OBJECTS}/share-object`, { method: 'POST', body: input }),
};

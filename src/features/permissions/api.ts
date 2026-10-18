import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';
import type { Permission } from '@/features/roles/api';

/**
 * Permission definitions — the named capabilities roles bundle up.
 *
 * Reads need `blocks-iam::iam::permissions`, writes `…::mutate-permissions`. Resource
 * groups are read-only (no CRUD exists for them). `resource/features` is the one read any
 * signed-in user may make: the frontend feature catalogue.
 */

const IAM = `${IAM_BASE}/iam`;

export interface PermissionInput {
  name: string;
  resource: string;
  resourceGroup?: string;
  description?: string;
  /** ResourceType enum — numeric on the wire. */
  type?: number;
  tags?: string[];
  dependentPermissions?: string[];
  isBuiltIn?: boolean;
  permissionSeverity?: number;
}

export interface PermissionFilter {
  search?: string;
  resourceGroup?: string;
  isArchived?: boolean;
  /** The server takes "yes" / "no", not a boolean. */
  isBuiltIn?: 'yes' | 'no';
  tags?: string[];
  resources?: string[];
}

export const permissions = {
  list: (p: { page?: number; pageSize?: number; filter?: PermissionFilter; roles?: string[]; organizationId?: string | null } = {}) =>
    blocksFetch<{ data: Permission[] | null; totalCount: number }>(`${IAM}/permissions`, {
      method: 'POST',
      body: {
        page: p.page ?? 0,
        pageSize: p.pageSize ?? 20,
        filter: { search: '', isArchived: false, ...p.filter },
        ...(p.roles?.length ? { roles: p.roles } : {}),
        ...(p.organizationId ? { organizationId: p.organizationId } : {}),
      },
    }),
  get: (id: string) => blocksFetch<{ data?: Permission }>(`${IAM}/permissions/${encodeURIComponent(id)}`),
  create: (input: PermissionInput) =>
    blocksFetch<{ isSuccess?: boolean; itemId?: string; errors?: unknown }>(`${IAM}/permissions/create`, {
      method: 'POST',
      body: { type: 1, tags: [], dependentPermissions: [], isBuiltIn: false, ...input },
    }),
  update: (id: string, input: PermissionInput & { isArchived?: boolean }) =>
    blocksFetch<{ isSuccess?: boolean }>(`${IAM}/permissions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { ...input, itemId: id },
    }),
  remove: (id: string, confirmRevokeFromUsers = false) =>
    blocksFetch<unknown>(`${IAM}/permissions/${encodeURIComponent(id)}?confirmRevokeFromUsers=${confirmRevokeFromUsers}`, {
      method: 'DELETE',
    }),
  archiveImpact: (id: string) => blocksFetch<Record<string, unknown>>(`${IAM}/permissions/${encodeURIComponent(id)}/archive-impact`),
  bySeverity: () => blocksFetch<unknown[]>(`${IAM}/permissions/by-severity`),
  resourceGroups: () => blocksFetch<unknown[]>(`${IAM}/resource-groups`),
  features: (search?: string) =>
    blocksFetch<{ resource?: string; name?: string; description?: string }[]>(
      `${IAM}/resource/features${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  /** Preview who/what a role's permission change would affect, before assign-permissions. */
  roleChangeImpact: (body: { slug: string; addPermissions?: string[]; removePermissions?: string[]; organizationId?: string | null }) =>
    blocksFetch<Record<string, unknown>>(`${IAM}/roles/permission-change-impact`, {
      method: 'POST',
      body: { addPermissions: [], removePermissions: [], ...body },
    }),
};

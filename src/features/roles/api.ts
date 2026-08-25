import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

const IAM = `${IAM_BASE}/iam`;

/**
 * Roles are an organization-scoped resource: every Role entity carries an
 * `organizationId`, and `POST /iam/roles` filters by it. Creation, however, does not
 * declare an org id in `CreateRoleRequest` — the server derives it from the caller's
 * context. We still send `organizationId` on create/update so a multi-org admin lands
 * the role in the org they are actually looking at; an older server simply ignores it.
 */

export interface Role {
  itemId: string;
  name?: string;
  slug?: string;
  description?: string;
  organizationId?: string;
  parentRoleSlug?: string;
  ancestorRoleSlugs?: string[];
  canCreateOwn?: boolean;
  /**
   * NOT a "built-in role" flag — the API returns `true` for roles a user just created
   * through the console too. Don't badge on it.
   */
  createdFromDefault?: boolean;
  isArchived?: boolean;
  /** Number of users holding the role, as returned by the list endpoint. */
  count?: number;
  createdDate?: string;
  lastUpdatedDate?: string;
}

export interface RolesPage {
  data: Role[] | null;
  totalCount: number;
  errors?: unknown;
}

export interface AssignableRole {
  slug?: string;
  name?: string;
}

export interface AssignableRoles {
  hierarchy?: AssignableRole[] | null;
  standalone?: AssignableRole[] | null;
}

export interface Permission {
  itemId: string;
  name?: string;
  description?: string;
  resource?: string;
  resourceGroup?: string;
  isBuiltIn?: boolean;
  isArchived?: boolean;
  roles?: string[] | null;
}

export interface CreateRoleInput {
  name: string;
  slug?: string;
  description?: string;
  parentRoleSlug?: string;
  canCreateOwn?: boolean;
  organizationId?: string;
}

export interface UpdateRoleInput {
  itemId: string;
  name?: string;
  description?: string;
  parentRoleSlug?: string;
  canCreateOwn?: boolean;
  /** Push the same change to every organization this role exists in. */
  propagateToOtherOrg?: boolean;
  organizationId?: string;
}

/**
 * `My Role Name` → `my_role_name`. The API keys roles by slug, not by name.
 *
 * Underscores, not hyphens — that is what the Blocks console produces (`Test role org`
 * → `test_role_org`), and a slug is permanent once created, so matching the platform
 * convention keeps roles from the two surfaces from looking like different species.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const roles = {
  /** Lists are POST, and `organizationId` sits at the root — not inside `filter`. */
  list: (params: {
    organizationId?: string | null;
    search?: string;
    slugs?: string[];
    page?: number;
    pageSize?: number;
  } = {}) => {
    const { organizationId, search, slugs, page = 0, pageSize = 20 } = params;
    return blocksFetch<RolesPage>(`${IAM}/roles`, {
      method: 'POST',
      // Shaped to match a verified-good request: `search` is an empty string rather
      // than null, and `slugs` is omitted entirely unless actually filtering by it.
      body: {
        page,
        pageSize,
        filter: { search: search?.trim() ?? '', ...(slugs?.length ? { slugs } : {}) },
        ...(organizationId ? { organizationId } : {}),
      },
    });
  },

  get: (id: string) => blocksFetch<{ data: Role; errors?: unknown }>(`${IAM}/roles/${id}`),

  create: ({ name, slug, ...rest }: CreateRoleInput) =>
    blocksFetch<unknown>(`${IAM}/roles/create`, {
      method: 'POST',
      body: { name, slug: slug?.trim() || slugify(name), canCreateOwn: false, ...rest },
    }),

  /** Update posts to a fixed path with the id in the body — not to /roles/{id}. */
  update: (body: UpdateRoleInput) =>
    blocksFetch<unknown>(`${IAM}/roles/update`, {
      method: 'POST',
      body: { propagateToOtherOrg: false, canCreateOwn: false, ...body },
    }),

  /**
   * Refuses to delete a role that is still held by users unless
   * `confirmRevokeFromUsers` is set — check `archiveImpact` first and make the caller
   * opt in, so nobody silently loses access.
   */
  remove: (id: string, confirmRevokeFromUsers = false) =>
    blocksFetch<unknown>(`${IAM}/roles/${id}?confirmRevokeFromUsers=${confirmRevokeFromUsers}`, {
      method: 'DELETE',
    }),

  /** Who/what a delete would affect. Shape varies by server, so it stays untyped. */
  archiveImpact: (id: string) =>
    blocksFetch<Record<string, unknown>>(`${IAM}/roles/${id}/archive-impact`),

  /** The roles the *signed-in* admin is allowed to grant — not every role in the org. */
  assignable: () => blocksFetch<AssignableRoles>(`${IAM}/roles/assignable`),

  /** Permission grants are per role slug, and optionally per organization. */
  setPermissions: (body: {
    slug: string;
    addPermissions?: string[];
    removePermissions?: string[];
    organizationId?: string | null;
    propagateToAllOrganizations?: boolean;
  }) =>
    blocksFetch<unknown>(`${IAM}/roles/assign-permissions`, {
      method: 'POST',
      body: {
        propagateToAllOrganizations: false,
        addPermissions: [],
        removePermissions: [],
        ...body,
      },
    }),

  permissions: (params: {
    organizationId?: string | null;
    roles?: string[];
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const { organizationId, roles: forRoles, search, page = 0, pageSize = 200 } = params;
    return blocksFetch<{ data: Permission[] | null; totalCount: number }>(`${IAM}/permissions`, {
      method: 'POST',
      body: {
        page,
        pageSize,
        filter: { search: search?.trim() ?? '', isArchived: false },
        ...(forRoles?.length ? { roles: forRoles } : {}),
        ...(organizationId ? { organizationId } : {}),
      },
    });
  },
};

import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS, IAM_BASE } from '@/lib/env';

const IAM = `${IAM_BASE}/iam`;

export interface Me {
  itemId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  roles: string[];
  permissions: string[];
  active: boolean;
  status: number;
  isVerified: boolean;
  mfaEnabled: boolean;
  userMfaType: number;
  attributes: Record<string, unknown>;
  logInCount: number;
  lastLoggedInTime: string;
}

export interface BlocksUser {
  itemId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  active?: boolean;
  isVerified?: boolean;
  roles?: string[];
  lastLoggedInTime?: string;
  createdDate?: string;
}

export interface Paged<T> {
  totalCount: number;
  data: T[];
}

export const users = {
  /**
   * The auth-state probe. `/iam/me` succeeds only with a valid session cookie, so a 401
   * is a real answer ("logged out"), not a failure — hence `null` instead of a throw.
   */
  meOrNull: async (): Promise<Me | null> => {
    try {
      const res = await fetch(`${IAM}/me`, {
        credentials: 'include',
        headers: { 'x-blocks-key': BLOCKS.projectKey },
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`me → ${res.status}`);
      return ((await res.json()) as { data: Me }).data;
    } catch {
      return null;
    }
  },

  me: () => blocksFetch<{ data: Me }>(`${IAM}/me`),

  patchMe: (body: Record<string, unknown>) =>
    blocksFetch<unknown>(`${IAM}/me`, { method: 'PATCH', body }),

  /** Lists are POST, not GET. */
  list: (body: Record<string, unknown> = {}) =>
    blocksFetch<Paged<BlocksUser>>(`${IAM}/users`, {
      method: 'POST',
      body: { page: 0, pageSize: 20, ...body },
    }),

  get: (id: string, organizationId?: string) =>
    blocksFetch<{ data: BlocksUser }>(
      `${IAM}/users/${id}${organizationId ? `?organizationId=${organizationId}` : ''}`,
    ),

  /** userPassType 1 = Password, userCreationType 2 = Api. */
  create: (body: Record<string, unknown>) =>
    blocksFetch<unknown>(`${IAM}/users/create`, {
      method: 'POST',
      body: { userPassType: 1, userCreationType: 2, ...body },
    }),

  update: (id: string, body: Record<string, unknown>) =>
    blocksFetch<unknown>(`${IAM}/users/${id}`, { method: 'POST', body: { ...body, itemId: id } }),

  /** Roles by slug, permissions by name — not part of a profile update. */
  assign: (userId: string, roles: string[], permissions: string[] = []) =>
    blocksFetch<unknown>(`${IAM}/users/roles-and-permissions`, {
      method: 'POST',
      body: { userId, roles, permissions },
    }),

  deactivate: (userId: string) =>
    blocksFetch<unknown>(`${IAM}/users/deactivate`, { method: 'POST', body: { userId } }),

  /** Swagger says GET, but the body can't ride a browser GET — the server accepts POST. */
  timeline: (targetUserId: string, body: Record<string, unknown> = {}) =>
    blocksFetch<Paged<Record<string, unknown>>>(`${IAM}/users/timeline`, {
      method: 'POST',
      body: { ItemId: targetUserId, page: 0, pageSize: 20, ...body },
    }),
};

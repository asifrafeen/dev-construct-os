import { blocksFetch, UnauthorizedError } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';
import { markSignedIn } from '@/state/auth-store';

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
  /** False between enrolling and proving the channel — see features/auth/mfa.ts. */
  isMfaVerified: boolean;
  /** UserMfaType: 0 none, 1 TOTP, 2 email, 3 SMS, 4 WhatsApp. */
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
   * The auth-state probe, and the route guard's only input.
   *
   * It must go through `blocksFetch`, not a bare `fetch`: an expired access token answers
   * 401, and only `blocksFetch` turns that into renew-then-retry. Probing directly would
   * read every expiry as "signed out" and bounce the user to /login while a perfectly good
   * refresh cookie sat unused.
   *
   * So a 401 here is already a *post-renewal* 401 — the session really is gone, and `null`
   * is the honest answer. Other failures (offline, 5xx) are not answers and propagate.
   */
  meOrNull: async (): Promise<Me | null> => {
    try {
      const { data } = await blocksFetch<{ data: Me }>(`${IAM}/me`);
      markSignedIn(); // a live session, however it was established
      return data;
    } catch (error) {
      if (error instanceof UnauthorizedError) return null;
      throw error;
    }
  },

  me: () => blocksFetch<{ data: Me }>(`${IAM}/me`),

  patchMe: (body: Record<string, unknown>) =>
    blocksFetch<unknown>(`${IAM}/me`, { method: 'PATCH', body }),

  /** Lists are POST, not GET. Org scoping rides in `filter.organizationIds`. */
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

  /**
   * Roles by slug, permissions by name — not part of a profile update.
   *
   * `organizationId` scopes the grant: the same user can hold different roles in each
   * organization they belong to, so omitting it grants against the caller's default org
   * rather than the one the UI is showing.
   *
   * This is a *replace*, not an append — send the user's full intended role set.
   */
  assign: (
    userId: string,
    roles: string[],
    permissions: string[] = [],
    organizationId?: string | null,
  ) =>
    blocksFetch<unknown>(`${IAM}/users/access`, {
      method: 'POST',
      body: { userId, roles, permissions, ...(organizationId ? { organizationId } : {}) },
    }),

  /** Drops every role and permission the user holds in that organization. */
  revokeAccess: (userId: string, organizationId?: string | null) =>
    blocksFetch<unknown>(`${IAM}/users/revoke-access`, {
      method: 'POST',
      body: { userId, ...(organizationId ? { organizationId } : {}) },
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

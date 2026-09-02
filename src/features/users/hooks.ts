import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrg } from '@/features/orgs/hooks';
import { users } from './api';

export const ME_KEY = ['iam', 'me'] as const;

/**
 * The auth-state source of truth. Cookie-based, so it works on a cold page load with
 * no JS-held token. `null` means logged out — a real answer, so never retried.
 */
export const useMe = () =>
  useQuery({
    queryKey: ME_KEY,
    queryFn: () => users.meOrNull(),
    staleTime: 60_000,
    retry: false,
  });

export function useIsLoggedIn() {
  const { data, isPending } = useMe();
  return { isLoggedIn: !!data, isChecking: isPending, me: data ?? null };
}

/** UI gating only — the server still enforces authorization. */
export function useHasPermission() {
  const { data: me } = useMe();
  return (permission: string) => !!me?.permissions?.includes(permission);
}

export const useUsers = (filter: Record<string, unknown> = {}, page = 0, pageSize = 20) =>
  useQuery({
    queryKey: ['iam', 'users', filter, page, pageSize],
    queryFn: () => users.list({ filter, page, pageSize }),
  });

export const useUserTimeline = (userId: string | undefined) =>
  useQuery({
    queryKey: ['iam', 'timeline', userId],
    queryFn: () => users.timeline(userId!),
    enabled: !!userId,
  });

/**
 * Grants roles (and optionally permissions) in the organization the UI is currently
 * showing. The call replaces the user's access in that org, so pass the complete
 * intended role set, not just the additions.
 */
export function useAssignUserAccess() {
  const qc = useQueryClient();
  const { activeOrgId } = useActiveOrg();
  return useMutation({
    mutationFn: ({
      userId,
      roles,
      permissions,
      organizationId,
    }: {
      userId: string;
      roles: string[];
      permissions?: string[];
      /** Defaults to the active org; pass explicitly to target another one. */
      organizationId?: string | null;
    }) =>
      users.assign(
        userId,
        roles,
        permissions ?? [],
        organizationId !== undefined ? organizationId : activeOrgId,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iam', 'users'] });
      qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function useRevokeUserAccess() {
  const qc = useQueryClient();
  const { activeOrgId } = useActiveOrg();
  return useMutation({
    mutationFn: ({ userId, organizationId }: { userId: string; organizationId?: string | null }) =>
      users.revokeAccess(userId, organizationId !== undefined ? organizationId : activeOrgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['iam', 'users'] }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  const { data: me } = useMe();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      // /iam/me is the only source of the caller's own id, and the request carries it
      // — see users.updateMe for why. No session, nothing to update.
      if (!me?.itemId) throw new Error('No signed-in user to update.');
      return users.updateMe(me.itemId, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useAssignUserAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      roles,
      permissions,
    }: {
      userId: string;
      roles: string[];
      permissions?: string[];
    }) => users.assign(userId, roles, permissions ?? []),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['iam', 'users'] }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => users.patchMe(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

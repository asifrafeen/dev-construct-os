import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrg } from '@/features/orgs/hooks';
import { roles, type CreateRoleInput, type UpdateRoleInput } from './api';

/** Every roles query is keyed by org, so switching orgs refetches instead of showing stale rows. */
const rolesKey = (organizationId: string | null, extra: unknown[] = []) =>
  ['iam', 'roles', organizationId, ...extra] as const;

export const useRoles = (
  { search = '', page = 0, pageSize = 20 }: { search?: string; page?: number; pageSize?: number } = {},
) => {
  const { activeOrgId } = useActiveOrg();
  return useQuery({
    queryKey: rolesKey(activeOrgId, ['list', search, page, pageSize]),
    queryFn: () => roles.list({ organizationId: activeOrgId, search, page, pageSize }),
  });
};

export const useRole = (id: string | undefined) => {
  const { activeOrgId } = useActiveOrg();
  return useQuery({
    queryKey: rolesKey(activeOrgId, ['one', id]),
    queryFn: () => roles.get(id!),
    enabled: !!id,
  });
};

/**
 * The grantable subset, flattened. `hierarchy` and `standalone` are two ways a role can
 * reach the admin; for "can I hand this out?" they are one list.
 */
export function useAssignableRoles() {
  const query = useQuery({
    queryKey: ['iam', 'roles', 'assignable'],
    queryFn: () => roles.assignable(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const slugs = useMemo(() => {
    const all = [...(query.data?.hierarchy ?? []), ...(query.data?.standalone ?? [])];
    return new Set(all.map((r) => r.slug).filter((s): s is string => !!s));
  }, [query.data]);

  return { ...query, assignableSlugs: slugs };
}

export const useRolePermissions = (slug: string | undefined) => {
  const { activeOrgId } = useActiveOrg();
  return useQuery({
    queryKey: rolesKey(activeOrgId, ['permissions', slug]),
    queryFn: () => roles.permissions({ organizationId: activeOrgId, roles: [slug!] }),
    enabled: !!slug,
  });
};

/** Invalidates the whole `['iam','roles']` subtree — cheap, and never leaves a stale list. */
function useRolesInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['iam', 'roles'] });
}

export function useCreateRole() {
  const { activeOrgId } = useActiveOrg();
  const invalidate = useRolesInvalidator();
  return useMutation({
    mutationFn: (input: CreateRoleInput) =>
      roles.create({ organizationId: activeOrgId ?? undefined, ...input }),
    onSuccess: invalidate,
  });
}

export function useUpdateRole() {
  const { activeOrgId } = useActiveOrg();
  const invalidate = useRolesInvalidator();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) =>
      roles.update({ organizationId: activeOrgId ?? undefined, ...input }),
    onSuccess: invalidate,
  });
}

export function useDeleteRole() {
  const invalidate = useRolesInvalidator();
  return useMutation({
    mutationFn: ({ id, confirmRevokeFromUsers }: { id: string; confirmRevokeFromUsers?: boolean }) =>
      roles.remove(id, confirmRevokeFromUsers ?? false),
    onSuccess: invalidate,
  });
}

export function useSetRolePermissions() {
  const { activeOrgId } = useActiveOrg();
  const invalidate = useRolesInvalidator();
  return useMutation({
    mutationFn: ({
      slug,
      addPermissions,
      removePermissions,
    }: {
      slug: string;
      addPermissions?: string[];
      removePermissions?: string[];
    }) =>
      roles.setPermissions({
        slug,
        addPermissions,
        removePermissions,
        organizationId: activeOrgId,
      }),
    onSuccess: invalidate,
  });
}

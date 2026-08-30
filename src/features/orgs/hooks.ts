import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { orgs, type CreateOrgInput, type ListOrgsParams, type Organization } from './api';

interface ActiveOrgState {
  activeOrgId: string | null;
  setActiveOrg: (id: string) => void;
}

/** Which org the user is working in should survive a reload. */
export const useActiveOrg = create<ActiveOrgState>()(
  persist(
    (set) => ({ activeOrgId: null, setActiveOrg: (id) => set({ activeOrgId: id }) }),
    { name: 'blocks-active-org' },
  ),
);

export const useMyOrgs = () =>
  useQuery({
    queryKey: ['iam', 'orgs', 'my'],
    queryFn: () => orgs.my(),
    select: (r) => r.organizations ?? [],
  });

/** Keeps a valid selection: preselects the first org, resets if the stored id vanishes. */
export function useMyOrgsWithActive() {
  const query = useMyOrgs();
  const { activeOrgId, setActiveOrg } = useActiveOrg();
  const list = query.data ?? [];

  useEffect(() => {
    if (!list.length) return;
    const stillValid = activeOrgId && list.some((o) => o.itemId === activeOrgId);
    if (!stillValid) setActiveOrg(list[0].itemId);
  }, [list, activeOrgId, setActiveOrg]);

  return { ...query, orgs: list, activeOrgId, setActiveOrg };
}

/** Every organization in the project, not just the ones the caller belongs to. */
export const useOrgs = (params: ListOrgsParams = {}) =>
  useQuery({
    queryKey: ['iam', 'orgs', 'list', params],
    queryFn: () => orgs.list(params),
  });

export const useOrg = (id: string | undefined) =>
  useQuery({
    queryKey: ['iam', 'orgs', 'one', id],
    queryFn: () => orgs.get(id as string),
    enabled: !!id,
    select: (r) => r.organization ?? null,
  });

function useOrgsInvalidator() {
  const qc = useQueryClient();
  // `my` matters too: creating an org usually adds the creator to it, and the header's
  // switcher reads that list.
  return () => qc.invalidateQueries({ queryKey: ['iam', 'orgs'] });
}

export function useCreateOrg() {
  const invalidate = useOrgsInvalidator();
  return useMutation({
    mutationFn: (input: CreateOrgInput) => orgs.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateOrg() {
  const invalidate = useOrgsInvalidator();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Organization>) => orgs.update(id, body),
    onSuccess: invalidate,
  });
}

export const useOrgConfig = () =>
  useQuery({ queryKey: ['iam', 'orgs', 'config'], queryFn: () => orgs.getConfig(), retry: false });

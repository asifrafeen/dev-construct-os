import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { orgs } from './api';

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

export const useOrgConfig = () =>
  useQuery({ queryKey: ['iam', 'orgs', 'config'], queryFn: () => orgs.getConfig(), retry: false });

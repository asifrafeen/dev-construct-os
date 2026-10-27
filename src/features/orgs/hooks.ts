import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { users } from '@/features/users/api';
import { orgs, type CreateOrgInput, type ListOrgsParams, type SaveOrgInput } from './api';

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
    mutationFn: ({ id, ...body }: { id: string } & SaveOrgInput & { isDisabled?: boolean }) =>
      orgs.update(id, body),
    onSuccess: invalidate,
  });
}

/**
 * IAM answered 200 to `/auth/switch-org`, but the session is not in the organization
 * that was asked for. `actual` is where `/iam/me` says it is, or null when `/iam/me`
 * reported no organization at all.
 */
export class OrgSwitchNotAppliedError extends Error {
  constructor(
    public requested: string,
    public actual: string | null,
    names: Map<string, string>,
  ) {
    const label = (id: string) => (names.has(id) ? `"${names.get(id)}"` : `"${id}"`);
    super(
      actual === null
        ? `The switch to ${label(requested)} could not be confirmed: IAM reports no organization for this session.`
        : `IAM did not switch to ${label(requested)}. The session is still in ${label(actual)}.` +
            (requested === 'default'
              ? ' A multi-organization project does not let a session switch into "default".'
              : ''),
    );
    this.name = 'OrgSwitchNotAppliedError';
  }
}

/**
 * Switch organization for real: the session moves, not just this tab's preference.
 *
 * A 200 from `/auth/switch-org` is not proof of a switch. IAM can accept the request
 * and still mint the token for another organization: on a multi-org project it drops
 * "default" from the request and falls back to the last used organization, yet answers
 * 200. So the switch is verified by reading `/iam/me`, whose `organizationId` is the
 * new access token's own `org_id` claim.
 *
 * On a mismatch the session is switched once more into the organization it actually
 * landed in. That is a repair, not a retry: IAM has already stored the *requested*
 * organization as the user's last used one and on the new refresh token, so without it
 * the next refresh would quietly move the session there behind the UI's back.
 *
 * The local marker always ends on the organization the session is really in (unchanged
 * when that is unknown), so the header switcher never shows a switch that didn't happen.
 *
 * Then everything is invalidated, which is not laziness. `/iam/me` projects roles and
 * permissions *for the session's organization* — `MapToSingleAccountFields(user,
 * contextOrgId)` — so the signed-in user's own access changes shape across a switch,
 * and with it every permission-gated screen. Users, roles and permission lists are all
 * scoped the same way. It runs on failure too: the tokens were reissued either way.
 */
export function useSwitchOrg() {
  const qc = useQueryClient();
  const setActiveOrg = useActiveOrg((s) => s.setActiveOrg);

  return useMutation({
    mutationFn: async (organizationId: string) => {
      await orgs.switchOrg(organizationId);

      const { data } = await users.me();
      const actual = data?.organizationId || null;
      if (actual === organizationId) return actual;

      if (actual !== null) {
        setActiveOrg(actual);
        try {
          await orgs.switchOrg(actual);
        } catch (error) {
          console.warn('Could not re-pin the session to its actual organization', error);
        }
      }

      const my = qc.getQueryData<Awaited<ReturnType<typeof orgs.my>>>(['iam', 'orgs', 'my']);
      const names = new Map((my?.organizations ?? []).map((o) => [o.itemId, o.name ?? o.itemId]));
      throw new OrgSwitchNotAppliedError(organizationId, actual, names);
    },
    onSuccess: (actual) => setActiveOrg(actual),
    onSettled: () => qc.invalidateQueries(),
  });
}

export const useOrgConfig = () =>
  useQuery({ queryKey: ['iam', 'orgs', 'config'], queryFn: () => orgs.getConfig(), retry: false });

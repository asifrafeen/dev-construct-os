import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

const IAM = `${IAM_BASE}/iam`;

/**
 * Organizations use a non-standard envelope: the payload sits under a *named* key
 * (`organizations`, `organization`, `itemId`) — not `data`. `/organizations/config`
 * is flat with no envelope at all.
 */
type Env<K extends string, T> = { isSuccess: boolean; errors?: unknown } & { [P in K]?: T };

export interface Organization {
  itemId: string;
  name: string;
  description?: string;
  shortCode?: string;
  isEnabled?: boolean;
  email?: string;
  websiteUrl?: string;
  industry?: string;
  timeZone?: string;
  currency?: string;
  logoUrl?: string;
  theme?: { primaryColor?: string; secondaryColor?: string; tertiaryColor?: string };
  defaultRoleForMembers?: string[];
  createdDate?: string;
}

export interface OrgConfig {
  allowOrgCreationFromCloud: boolean;
  allowOrgCreationFromConstruct: boolean;
  allowOrgCreationFromSignup: boolean;
  allowOrgCreationFromPortal: boolean;
  isMultiOrgEnabled: boolean;
  consentForMultiOrgEnable: boolean;
  itemId?: string;
}

export const orgs = {
  /** List is a GET with query params (unlike users, which is a POST). */
  list: (params: Record<string, string | number | boolean> = {}) => {
    const qs = new URLSearchParams({
      Page: '0',
      PageSize: '20',
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    return blocksFetch<Env<'organizations', Organization[]>>(`${IAM}/organizations?${qs}`);
  },

  /** The signed-in user's own organizations — identified purely by the session cookie. */
  my: () => blocksFetch<Env<'organizations', Organization[]>>(`${IAM}/organizations/my`),

  get: (id: string) => blocksFetch<Env<'organization', Organization>>(`${IAM}/organizations/${id}`),

  create: (body: Record<string, unknown>) =>
    blocksFetch<Env<'itemId', string>>(`${IAM}/organizations/create`, { method: 'POST', body }),

  update: (id: string, body: Record<string, unknown>) =>
    blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/${id}`, { method: 'POST', body }),

  getConfig: () => blocksFetch<OrgConfig>(`${IAM}/organizations/config`),

  setConfig: (cfg: OrgConfig) =>
    blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/config`, { method: 'POST', body: cfg }),
};

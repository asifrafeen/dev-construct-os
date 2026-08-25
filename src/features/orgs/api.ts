import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

const IAM = `${IAM_BASE}/iam`;

/**
 * Organizations use a non-standard envelope: the payload sits under a *named* key
 * (`organizations`, `organization`, `itemId`) — not `data`. `/organizations/config`
 * is flat with no envelope at all.
 */
type Env<K extends string, T> = { isSuccess: boolean; errors?: unknown } & { [P in K]?: T };

export interface Address {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  isPrimary?: boolean;
}

export interface Theme {
  name?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
  attributes?: Record<string, unknown>;
}

export interface Organization {
  itemId: string;
  name?: string;
  description?: string;
  shortCode?: string;
  parentOrganizationId?: string;
  /**
   * Note the polarity: the entity reports `isDisabled`, while the *save* request takes
   * `isEnable`. They are inverses of each other — don't wire one straight to the other.
   */
  isDisabled?: boolean;
  defaultRoleForMembers?: string[];
  defaultPermissionsForMembers?: string[];
  email?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  addresses?: Address[];
  theme?: Theme;
  logoUrl?: string;
  logoId?: string;
  industry?: string;
  timeZone?: string;
  currency?: string;
  dateFormat?: string;
  timeFormat?: string;
  locale?: string;
  attributes?: Record<string, unknown>;
  createdDate?: string;
  lastUpdatedDate?: string;
  createdBy?: string;
  tags?: string[];
}

/** `/organizations/my` returns a deliberately thin projection — not a full Organization. */
export interface MyOrganizationInfo {
  itemId: string;
  name?: string;
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

/**
 * `CreatedFrom` is declared as an unnamed enum [1, 2, 3] — the Swagger publishes no
 * member names, and the IAM source in this workspace predates the create endpoint, so
 * the mapping could not be confirmed. 2 is the reasoned guess for Construct (the org
 * config gates creation per surface: Cloud, Construct, Signup, Portal).
 *
 * If `POST /organizations/create` rejects the value, this constant is the only line
 * that needs to change.
 */
export const CREATED_FROM_CONSTRUCT = 2;

export interface CreateOrgInput {
  name: string;
  description?: string;
  email?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  /** Roles every new member of this org receives, by slug. */
  defaultRoleForMembers?: string[];
  defaultPermissionsForMembers?: string[];
  addresses?: Address[];
  attributes?: Record<string, unknown>;
}

export interface ListOrgsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isDisabled?: boolean;
  parentOrganizationId?: string;
  sortProperty?: string;
  sortDescending?: boolean;
}

export const orgs = {
  /**
   * List is a GET with query params (unlike users and roles, which are POSTs), and the
   * names are PascalCase with dotted paths — `Filter.Search`, not `filter.search`.
   */
  list: (params: ListOrgsParams = {}) => {
    const {
      page = 0,
      pageSize = 20,
      search,
      isDisabled,
      parentOrganizationId,
      sortProperty,
      sortDescending,
    } = params;

    const qs = new URLSearchParams({ Page: String(page), PageSize: String(pageSize) });
    // Only send the filters that are actually set — the roles list 400s on null
    // filter values, so don't hand this one empty keys either.
    if (search?.trim()) qs.set('Filter.Search', search.trim());
    if (isDisabled !== undefined) qs.set('Filter.IsDisabled', String(isDisabled));
    if (parentOrganizationId) qs.set('Filter.ParentOrganizationId', parentOrganizationId);
    if (sortProperty) {
      qs.set('Sort.Property', sortProperty);
      qs.set('Sort.IsDescending', String(sortDescending ?? false));
    }

    return blocksFetch<Env<'organizations', Organization[]> & { totalCount?: number }>(
      `${IAM}/organizations?${qs}`,
    );
  },

  /** The signed-in user's own organizations — identified purely by the session cookie. */
  my: () => blocksFetch<Env<'organizations', MyOrganizationInfo[]>>(`${IAM}/organizations/my`),

  get: (id: string) => blocksFetch<Env<'organization', Organization>>(`${IAM}/organizations/${id}`),

  create: (body: CreateOrgInput) =>
    blocksFetch<Env<'itemId', string>>(`${IAM}/organizations/create`, {
      method: 'POST',
      body: { createdFrom: CREATED_FROM_CONSTRUCT, ...body },
    }),

  /**
   * Save takes `isEnable` (enabled), while the entity reads back `isDisabled`. Callers
   * pass the entity's polarity and the flip happens here, once.
   */
  update: (id: string, body: Partial<Organization> & { isDisabled?: boolean }) => {
    const { isDisabled, itemId: _itemId, ...rest } = body;
    return blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/${id}`, {
      method: 'POST',
      body: { ...rest, ...(isDisabled === undefined ? {} : { isEnable: !isDisabled }) },
    });
  },

  getConfig: () => blocksFetch<OrgConfig>(`${IAM}/organizations/config`),

  setConfig: (cfg: OrgConfig) =>
    blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/config`, {
      method: 'POST',
      body: cfg,
    }),
};

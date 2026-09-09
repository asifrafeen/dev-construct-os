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
 * member names, so this value is not derivable from the spec. 3 is Construct, per the
 * platform team.
 *
 * The server pairs it with the matching `allowOrgCreationFrom*` flag in the org config,
 * so a wrong value gets checked against the wrong gate. Don't "fix" it by guessing.
 */
export const CREATED_FROM_CONSTRUCT = 3;

/**
 * Mirrors `CreateOrganizationRequest`. `name` is the only required field, and the
 * schema is `additionalProperties: false` — an undeclared key is a 400, not a field the
 * server shrugs off. Notably absent here versus the entity: `shortCode` (server-issued),
 * `parentOrganizationId`, and `logoId` (create takes `logoUrl` only).
 */
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
  theme?: Theme;
  logoUrl?: string;
  industry?: string;
  timeZone?: string;
  currency?: string;
  dateFormat?: string;
  timeFormat?: string;
  locale?: string;
}

/**
 * Mirrors `SaveOrganizationRequest`, minus the enabled flag which callers express as
 * the entity's `isDisabled` (see `orgs.update`). Kept as its own type so a whole
 * `Organization` can't be spread into the request: the entity carries `itemId`,
 * `createdDate`, `shortCode` and friends, none of which the strict schema accepts.
 */
export interface SaveOrgInput {
  name?: string;
  description?: string;
  email?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  defaultRoleForMembers?: string[];
  defaultPermissionsForMembers?: string[];
  addresses?: Address[];
  attributes?: Record<string, unknown>;
  theme?: Theme;
  logoUrl?: string;
  logoId?: string;
  industry?: string;
  timeZone?: string;
  currency?: string;
  dateFormat?: string;
  timeFormat?: string;
  locale?: string;
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
   *
   * Fields are picked explicitly rather than spread: the schema is strict, so leaking
   * a read-only entity field like `createdDate` would fail the whole save.
   */
  update: (id: string, body: SaveOrgInput & { isDisabled?: boolean }) => {
    const { isDisabled, ...rest } = body;
    const allowed: (keyof SaveOrgInput)[] = [
      'name',
      'description',
      'email',
      'phoneNumber',
      'websiteUrl',
      'defaultRoleForMembers',
      'defaultPermissionsForMembers',
      'addresses',
      'attributes',
      'theme',
      'logoUrl',
      'logoId',
      'industry',
      'timeZone',
      'currency',
      'dateFormat',
      'timeFormat',
      'locale',
    ];
    const payload: Record<string, unknown> = {};
    for (const key of allowed) if (rest[key] !== undefined) payload[key] = rest[key];
    if (isDisabled !== undefined) payload.isEnable = !isDisabled;

    return blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/${id}`, {
      method: 'POST',
      body: payload,
    });
  },

  /**
   * Move the *session* into another organization.
   *
   * Lives under `auth/`, not `iam/`, because it is a re-authentication: IAM reissues
   * the access and refresh tokens carrying the new organization claim and sets them as
   * cookies, exactly as login does. Nothing about the user record changes.
   *
   * The body key is snake_case — `SwitchOrganizationRequest` pins it with
   * `[JsonPropertyName("organization_id")]`, so camelCase is silently ignored and the
   * call fails as `invalid_request`.
   *
   * Membership is enforced server-side against the user's organizations, roles and
   * permissions; anything else is refused with `organization_not_available`.
   *
   * Deliberately NOT `noRetry`. A refresh token inside its rotation grace window is
   * refused here with `session_expired` — IAM will not switch on a superseded token,
   * because the access half would carry the new organization while the refresh half
   * stayed bound to the old one, and the next refresh would silently undo the switch.
   * Its documented recovery is "refresh, then switch again", which is exactly what
   * blocksFetch's 401 path does on our behalf.
   */
  switchOrg: (organizationId: string) =>
    blocksFetch<unknown>(`${IAM_BASE}/auth/switch-org`, {
      method: 'POST',
      body: { organization_id: organizationId },
    }),

  getConfig: () => blocksFetch<OrgConfig>(`${IAM}/organizations/config`),

  setConfig: (cfg: OrgConfig) =>
    blocksFetch<{ isSuccess: boolean }>(`${IAM}/organizations/config`, {
      method: 'POST',
      body: cfg,
    }),
};

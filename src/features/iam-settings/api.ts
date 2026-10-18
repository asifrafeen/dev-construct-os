import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

/**
 * Tenant-level IAM configuration that a project admin can change from the app — each
 * behind its own `blocks-iam::*` permission, so expect 403s for an ordinary member.
 *
 * The request schemas are treated as strict: saves send only the fields listed here, never
 * an echoed GET response (those carry `itemId` and other read-only keys).
 */

const IAM = `${IAM_BASE}/iam`;
const AUTH = `${IAM_BASE}/auth`;

export interface SignupSettings {
  isEmailPasswordSignUpEnabled: boolean;
  isSSoSignUpEnabled: boolean;
  defaultRolesForNewUserOnSignUp: string[];
  defaultPermissionsForNewUserOnSignUp: string[];
}

export interface OrgConfigAdmin {
  allowOrgCreationFromCloud?: boolean;
  allowOrgCreationFromConstruct?: boolean;
  allowOrgCreationFromSignup?: boolean;
  allowOrgCreationFromPortal?: boolean;
  isMultiOrgEnabled?: boolean;
  consentForMultiOrgEnable?: boolean;
  /** Null on save means "keep what is stored". */
  isOrgNameUniquenessEnabled?: boolean | null;
  isSignupAutoJoinEnabled?: boolean | null;
  signupAutoJoinOrganizationId?: string | null;
}

export const ORG_CONFIG_KEYS: (keyof OrgConfigAdmin)[] = [
  'allowOrgCreationFromCloud',
  'allowOrgCreationFromConstruct',
  'allowOrgCreationFromSignup',
  'allowOrgCreationFromPortal',
  'isMultiOrgEnabled',
  'consentForMultiOrgEnable',
  'isOrgNameUniquenessEnabled',
  'isSignupAutoJoinEnabled',
  'signupAutoJoinOrganizationId',
];

export interface MfaPolicyInput {
  enableMfa: boolean;
  userMfaType: number[];
  requireMfaForAllUsers: boolean;
  mfaRequiredRoles: string[];
  mfaExemptRoles: string[];
  allowUserOptOut: boolean;
  allowBackupCodes: boolean;
  backupCodesCount: number;
  mfaTemplate?: { templateId?: string; templateName?: string };
}

export interface ClientCredential {
  itemId: string;
  name?: string;
  clientId?: string;
  isActive?: boolean;
  accessTokenValidForNumberMinutes?: number;
  roles?: string[];
  permissions?: string[];
  organizationId?: string;
  createdDate?: string;
  [k: string]: unknown;
}

export interface ClientCredentialInput {
  itemId?: string;
  name: string;
  isActive: boolean;
  accessTokenValidForNumberMinutes: number;
  roles: string[];
  permissions: string[];
  organizationId?: string | null;
}

export function pick<T extends object>(source: Record<string, unknown>, keys: (keyof T)[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (source[k as string] !== undefined) out[k as string] = source[k as string];
  return out as Partial<T>;
}

export const iamSettings = {
  signupAdmin: () => blocksFetch<SignupSettings & Record<string, unknown>>(`${IAM}/signup-settings/admin`),
  saveSignup: (body: SignupSettings) => blocksFetch<unknown>(`${IAM}/signup-settings`, { method: 'POST', body }),

  /** The token-tenant view — includes the auto-join target the anonymous GET leaves out. */
  orgConfigAdmin: () => blocksFetch<OrgConfigAdmin & Record<string, unknown>>(`${IAM}/organizations/config/admin`),
  saveOrgConfig: (body: OrgConfigAdmin) => blocksFetch<unknown>(`${IAM}/organizations/config`, { method: 'POST', body }),

  mfaPolicy: () => blocksFetch<Partial<MfaPolicyInput> & Record<string, unknown>>(`${IAM_BASE}/mfa/config`),
  saveMfaPolicy: (body: MfaPolicyInput) => blocksFetch<unknown>(`${IAM_BASE}/mfa/config`, { method: 'POST', body }),

  clientCredentials: () => blocksFetch<unknown>(`${AUTH}/client-credentials`),
  saveClientCredential: (body: ClientCredentialInput) =>
    blocksFetch<Record<string, unknown>>(`${AUTH}/client-credentials`, { method: 'POST', body }),
  rotateClientSecret: (id: string) =>
    blocksFetch<Record<string, unknown>>(`${AUTH}/client-credentials/${encodeURIComponent(id)}/rotate-secret`, { method: 'POST', body: {} }),
  deleteClientCredential: (id: string) =>
    blocksFetch<unknown>(`${AUTH}/client-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  identityProviders: () => blocksFetch<{ data?: unknown; isSuccess?: boolean }>(`${AUTH}/identity-providers`),
  setIdentityProviderActive: (id: string, isActive: boolean) =>
    blocksFetch<unknown>(`${AUTH}/identity-providers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { isActive } }),

  authConfig: () => blocksFetch<Record<string, unknown>>(`${AUTH}/config`),
  oidcClients: () => blocksFetch<unknown>(`${IAM_BASE}/oidc-clients`),
  loginOptions: () => blocksFetch<unknown>(`${AUTH}/login-options`, { noRetry: true }),
};

/** Lists come back bare, under `data`, or under a named key — take the first array found. */
export function firstArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

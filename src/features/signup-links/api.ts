import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

/**
 * The admin side of one-click signup links — the half that *issues* them. The invitee's
 * half (context / redeem) lives in features/auth/signup-link.ts.
 *
 * Both calls need `blocks-iam::iam::manage-signup-links` on the signed-in user.
 *
 *   POST iam/signup-links/configurations/query  → the configurations a link can be cut from
 *   POST iam/signup-links                        → generate one link for one named invitee
 */

const SIGNUP_LINKS = `${IAM_BASE}/iam/signup-links`;

/**
 * IAM serialises these enums by name on some builds and by ordinal on others
 * (Oidc = 0, Embedded = 1; Passwordless = 0, PasswordRequired = 1), so both are typed.
 */
export type SignupLinkModeValue = 'Oidc' | 'Embedded' | 0 | 1;
export type CredentialModeValue = 'Passwordless' | 'PasswordRequired' | 0 | 1;

export interface SignupLinkConfiguration {
  itemId: string;
  name: string;
  description?: string | null;
  defaultRoles: string[];
  defaultPermissions: string[];
  clientId: string;
  redirectUri: string;
  defaultForwardedTo?: string | null;
  credentialMode: CredentialModeValue;
  mode: SignupLinkModeValue;
  joinUrl?: string | null;
  signInAfterActivation: boolean;
  defaultLifetimeMinutes: number;
  /** null → single use; 0 → unlimited until expiry. */
  defaultMaxRedemptions?: number | null;
  isActive: boolean;
  createdDate: string;
  lastUpdatedDate: string;
}

export interface SignupLinkConfigurationList {
  items: SignupLinkConfiguration[];
  totalCount: number;
}

/**
 * Mirrors `GenerateSignupLinkRequest`. Every optional field falls back to the
 * configuration when omitted — and so does an *empty* roles or permissions list.
 */
export interface GenerateSignupLinkInput {
  configurationId: string;
  email: string;
  firstName: string;
  lastName: string;
  language?: string;
  roles?: string[];
  permissions?: string[];
  /** Relative path only; IAM rejects anything absolute. */
  forwardedTo?: string;
  /** 5 – 10080. */
  expiresInMinutes?: number;
  /** 0 = no cap. */
  maxRedemptions?: number;
}

export interface GeneratedSignupLink {
  linkId: string;
  /**
   * Oidc: IAM's hosted join page. Embedded: built from the configuration's joinUrl, or
   * null when it has none — the caller then composes the link from `code`.
   */
  url?: string | null;
  code: string;
  expiresAtUtc: string;
  /** The invitee already has an account; redeeming signs them in rather than creating one. */
  emailAlreadyExists: boolean;
}

export const modeLabel = (mode: SignupLinkModeValue) =>
  mode === 'Embedded' || mode === 1 ? 'Embedded' : 'OIDC';

export const credentialModeLabel = (mode: CredentialModeValue) =>
  mode === 'PasswordRequired' || mode === 1 ? 'Password required' : 'Passwordless';

/**
 * The link to hand the invitee. Falls back to this app's own /invitation page, which
 * reads the code from the fragment exactly as IAM composes it (`#link=<code>`).
 */
export function inviteUrl(link: GeneratedSignupLink): string {
  if (link.url) return link.url;
  return `${window.location.origin}/invitation#link=${encodeURIComponent(link.code)}`;
}

export const signupLinks = {
  configurations: (
    params: { page?: number; pageSize?: number; includeInactive?: boolean; search?: string } = {},
  ) => {
    const { page = 0, pageSize = 100, includeInactive = false, search } = params;
    return blocksFetch<SignupLinkConfigurationList>(`${SIGNUP_LINKS}/configurations/query`, {
      method: 'POST',
      body: { page, pageSize, includeInactive, ...(search?.trim() ? { search: search.trim() } : {}) },
    });
  },

  generate: (body: GenerateSignupLinkInput) =>
    blocksFetch<GeneratedSignupLink>(SIGNUP_LINKS, { method: 'POST', body }),
};

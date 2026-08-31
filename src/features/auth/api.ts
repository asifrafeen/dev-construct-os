import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { BLOCKS, IAM_BASE } from '@/lib/env';
import {
  accountErrorFromError,
  assertAccountOk,
  authErrorMessage,
  type AccountResponse,
} from './errors';

/**
 * Start password recovery. Always resolves for a well-formed address, whether or not
 * an account exists — IAM answers identically either way so the endpoint cannot be
 * used to discover who has an account. Do not "improve" this by reporting not-found.
 *
 * The emailed link's origin is derived from the Origin/Referer of *this* request when
 * the project has no fixed AccountActionBaseUrl, so it points back at whichever host
 * the user was on.
 *
 * `captchaCode` is the code the challenge produced, when the project configured one
 * — see features/auth/captcha.ts. It is left out entirely rather than sent empty,
 * because IAM reads its presence as "a challenge was answered".
 */
export async function recoverAccount(email: string, captchaCode?: string): Promise<void> {
  const res = await blocksFetch<AccountResponse>(`${IAM_BASE}/auth/recover`, {
    method: 'POST',
    body: {
      email,
      tenantId: BLOCKS.projectKey,
      ...(captchaCode ? { captchaCode } : {}),
    },
    noRetry: true,
  });
  // A 200 here still carries `isSuccess: false` for validation failures.
  assertAccountOk(res);
}

/**
 * What the project allows an anonymous visitor to do. Published unauthenticated on
 * purpose — the sign-in page has to know whether to offer a "create an account" link
 * before anyone has a session.
 */
export interface SignupSettings {
  /** The master switch. False hides sign-up whatever the two below say. */
  isSignUpEnable: boolean;
  isEmailPasswordSignUpEnabled: boolean;
  isSSoSignUpEnabled: boolean;
}

/** Shared so the sign-in page and the sign-up page read one cached answer. */
export const SIGNUP_SETTINGS_KEY = ['auth', 'signup-settings'] as const;

export const getSignupSettings = (): Promise<SignupSettings> =>
  blocksFetch<SignupSettings>(`${IAM_BASE}/iam/signup-settings`, { noRetry: true });

/** True when a visitor can register with an email address on this project. */
export const emailSignupAllowed = (settings: SignupSettings | null | undefined): boolean =>
  !!settings?.isSignUpEnable && !!settings.isEmailPasswordSignUpEnabled;

/**
 * Whether this project lets a new account bring its own organization.
 *
 * Anonymous, like signup-settings — the sign-up page reads it before rendering to
 * decide whether to ask for an organization at all. Both flags have to be on: IAM
 * answers `multi_org_disabled` for the first and `org_creation_disabled` for the
 * second, and either one fails the *whole* signup, user included, because the org is
 * created before the user.
 */
export interface OrganizationConfig {
  isMultiOrgEnabled: boolean;
  allowOrgCreationFromSignup: boolean;
  allowOrgCreationFromPortal: boolean;
  allowOrgCreationFromCloud: boolean;
  allowOrgCreationFromConstruct: boolean;
}

export const ORGANIZATION_CONFIG_KEY = ['iam', 'organization-config'] as const;

export const getOrganizationConfig = (): Promise<OrganizationConfig> =>
  blocksFetch<OrganizationConfig>(`${IAM_BASE}/iam/organizations/config`, { noRetry: true });

/** True when signup may create an organization on this project. */
export const orgSignupAllowed = (config: OrganizationConfig | null | undefined): boolean =>
  !!config?.isMultiOrgEnabled && !!config.allowOrgCreationFromSignup;

/**
 * The organization profile signup accepts — IAM's `SignupOrganizationInfo`, which is an
 * allowlist rather than the full create request.
 *
 * What is missing is missing on purpose, server-side: `defaultRoleForMembers` and
 * `defaultPermissionsForMembers` are inherited by every later member of the org, and
 * signup is anonymous, so accepting them would let a stranger mint themselves an admin
 * org. Same for `parentOrganizationId`, `isDisabled`, `logoId` and `shortCode`. Do not
 * "complete" this type from the Organization entity.
 *
 * Only `name` is required. Everything else is optional so the form can grow without
 * the API layer changing.
 */
export interface SignupOrganization {
  name: string;
  description?: string;
  email?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  industry?: string;
  /** IANA id; IAM rejects anything TimeZoneInfo cannot resolve. */
  timeZone?: string;
  locale?: string;
  /** Exactly three letters, e.g. CHF. */
  currency?: string;
  dateFormat?: string;
  timeFormat?: string;
  logoUrl?: string;
  addresses?: Array<{
    name?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    isPrimary?: boolean;
  }>;
  theme?: {
    name?: string;
    /** Hex, e.g. #124091. */
    primaryColor?: string;
    secondaryColor?: string;
    tertiaryColor?: string;
  };
  attributes?: Record<string, unknown>;
}

export interface SignupInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  /** Answered challenge, when the project configured one — see ./captcha.ts. */
  captchaCode?: string;
  /** Supplied only when the project allows it — see orgSignupAllowed. */
  organization?: SignupOrganization;
}

export interface SignupResult {
  /** The new user's id. */
  itemId: string | null;
  /** The organization created alongside it, when one was asked for. */
  organizationId: string | null;
}

/**
 * Self-service registration.
 *
 * Note what this does *not* take: a password. IAM creates the account unverified and
 * inactive, mails an activation link, and the password is set on /activate — the same
 * page an invited user lands on. So there is nothing to sign in with until the link is
 * followed, and this call never establishes a session.
 *
 * The project's own default roles and permissions are applied server-side; the client
 * neither sends nor can influence them.
 *
 * With an `organization`, one call creates both. Note the ordering IAM uses: the org is
 * created *first*, so a rejected organization means no user either — and a rejected
 * user rolls the org back. There is no half-finished state to recover from, which is
 * why the form can simply stay put on a 400.
 *
 * The profile goes out twice, in the nested object and in the legacy flat pair. That is
 * not redundancy for its own sake: the nested `organization` is the newer contract and
 * an IAM that predates it ignores the unknown field and reads `organizationName`, while
 * a current one takes `organization.name` by documented precedence. Both are satisfied
 * by one request, so this works either side of the IAM deployment.
 */
export async function signUp(input: SignupInput): Promise<SignupResult> {
  const org = input.organization;

  const res = await blocksFetch<AccountResponse & { organizationId?: string }>(
    `${IAM_BASE}/auth/signup`,
    {
      method: 'POST',
      body: {
        email: input.email,
        firstName: input.firstName?.trim() || undefined,
        lastName: input.lastName?.trim() || undefined,
        phoneNumber: input.phoneNumber?.trim() || undefined,
        isSsoSignup: false,
        ...(input.captchaCode ? { captchaCode: input.captchaCode } : {}),
        ...(org
          ? {
              createOrganizationDuringSignup: true,
              organization: org,
              // Back-compat, see above. IAM trims the name either way.
              organizationName: org.name,
              organizationDescription: org.description,
            }
          : {}),
      },
      noRetry: true, // nobody is signed in here; a 401 would not be renewable
    },
  );
  // Belt and braces: IAM answers 400 on failure (already thrown by now), but the
  // account shape allows a 200 with isSuccess:false and that must not read as success.
  assertAccountOk(res);

  return { itemId: res.itemId ?? null, organizationId: res.organizationId ?? null };
}

/**
 * Server-side limits from `SignupOrganizationValidator`, mirrored so the form can stop
 * a value before the round trip. Keep them in step with the validator — a form that
 * lets through what IAM rejects turns a typo into a failed submit.
 */
export const SIGNUP_ORG_LIMITS = {
  name: 150,
  description: 500,
  maxAddresses: 5,
  addressName: 100,
  addressLine: 200,
  city: 100,
  state: 100,
  postalCode: 20,
  country: 100,
  /** From SignupAttributeNormalizer — it drops or truncates rather than complaining. */
  maxAttributes: 25,
  attributeKey: 64,
  attributeValue: 512,
} as const;

/**
 * Why IAM would refuse an attribute key. Null when it is fine.
 *
 * The normalizer silently *drops* bad keys rather than erroring, so without this the
 * user would submit, succeed, and find their attribute missing.
 */
export function attributeKeyProblem(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length > SIGNUP_ORG_LIMITS.attributeKey)
    return `Keep it under ${SIGNUP_ORG_LIMITS.attributeKey} characters.`;
  // Both are illegal MongoDB field names.
  if (trimmed.startsWith('$')) return 'Cannot start with $.';
  if (trimmed.includes('.')) return 'Cannot contain a dot.';
  return null;
}

/**
 * A form value is always a string, but the attribute store keeps real JSON types and
 * IAM normalizes numbers and booleans as such. So "10" is sent as 10 and "true" as
 * true — but only when the conversion round-trips exactly.
 *
 * That guard is the point: it keeps "0123" and "1.50" as the strings they plainly are,
 * rather than silently turning a postal code into 123.
 */
export function coerceAttributeValue(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && String(Number(value)) === value) return Number(value);
  return raw;
}

/** Exact error keys owned by the organization step. */
const ORG_ERROR_KEYS = new Set([
  'name_already_exists',
  'multi_org_disabled',
  'org_creation_disabled',
  'organization_creation_failed',
  'OrganizationName',
  'Name',
  'Description',
  'WebsiteUrl',
  'LogoUrl',
  'Industry',
  'TimeZone',
  'Currency',
  'Locale',
  'DateFormat',
  'TimeFormat',
  'Addresses',
]);

/**
 * Whether a failure belongs to the organization step rather than the person's.
 *
 * IAM flattens both halves into one `errors` map, and the form has to land the message
 * on the step that can fix it. Three shapes to catch:
 *
 *   fixed codes and property names  → the set above
 *   per-item validator keys         → "Addresses[0].City", "Theme.PrimaryColor"
 *   `Email`                         → ambiguous, and the reason for the message check
 *
 * `Email` is emitted by *both* validators: "Email is required." for the account's own
 * address, "Email invalid" for the organization's. Same key, different owner, so the
 * message is the only thing that separates them (verified against dev IAM).
 */
function ownedByOrganization(key: string, message: string): boolean {
  if (ORG_ERROR_KEYS.has(key)) return true;
  if (key.startsWith('Addresses[') || key.startsWith('Theme.')) return true;
  if (key === 'Email') return message.trim().toLowerCase() === 'email invalid';
  return false;
}

export interface SignupFailure {
  /** IAM's raw `{ key: message }` map. */
  errors: Record<string, string>;
  /** First message, ready to print. */
  message: string;
  /** True when the organization step is the one that can fix it. */
  isOrganizationError: boolean;
  /** True for a name clash specifically — the one failure with a one-click fix. */
  isNameTaken: boolean;
  /**
   * Free alternatives IAM offers alongside a name clash. Empty against an IAM that
   * predates them, so never render a "pick one of these" UI without a fallback.
   */
  nameSuggestions: string[];
}

/** Unpacks a thrown signup 400 into something the form can route. Null if not one. */
export function signupFailure(error: unknown): SignupFailure | null {
  if (!(error instanceof BlocksError)) return null;

  let body: unknown = error.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;

  const parsed = body as AccountResponse & { organizationNameSuggestions?: unknown };
  const errors = (parsed.errors ?? {}) as Record<string, string>;
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;

  const suggestions = Array.isArray(parsed.organizationNameSuggestions)
    ? parsed.organizationNameSuggestions.filter((n): n is string => typeof n === 'string')
    : [];

  return {
    errors,
    message: signupErrorMessage(error),
    isOrganizationError: keys.some((key) => ownedByOrganization(key, errors[key] ?? '')),
    isNameTaken: keys.includes('name_already_exists'),
    nameSuggestions: suggestions,
  };
}

export interface OrganizationNameAvailability {
  isAvailable: boolean;
  suggestions: string[];
}

/**
 * Advisory check for the organization step, so a clash surfaces while the user is
 * still typing rather than at final submit.
 *
 * Advisory in both directions. It is a check-then-act gap by nature — the name can go
 * between here and submit — and the endpoint is newer than some deployed IAMs, which
 * answer the SPA's HTML instead of JSON. So anything that is not a well-formed answer
 * resolves to null and the caller says nothing; `CreateOrganizationAsync` remains the
 * only authority.
 */
export async function checkOrganizationName(
  name: string,
): Promise<OrganizationNameAvailability | null> {
  try {
    const res = await blocksFetch<unknown>(
      `${IAM_BASE}/iam/organizations/name/available?name=${encodeURIComponent(name)}`,
      { noRetry: true, headers: { accept: 'application/json' } },
    );
    if (!res || typeof res !== 'object' || !('isAvailable' in res)) return null;

    const answer = res as { isAvailable?: unknown; suggestions?: unknown };
    if (typeof answer.isAvailable !== 'boolean') return null;

    return {
      isAvailable: answer.isAvailable,
      suggestions: Array.isArray(answer.suggestions)
        ? answer.suggestions.filter((n): n is string => typeof n === 'string')
        : [],
    };
  } catch {
    // Not deployed, multi-org off, offline — none of which should block the form.
    return null;
  }
}

/**
 * IAM's own wording is fine for most signup failures — "x@y is already registered",
 * "Email is required." — so only the ones that read like internal notes are replaced.
 */
const SIGNUP_ERROR_HELP: Record<string, string> = {
  'sign-up is disabled.': 'This project is not accepting new accounts right now.',
  'sso sign-up is disabled.': 'This project is not accepting new accounts right now.',
  'Organization creation is disabled because multi-organization mode is off.':
    'This project cannot create organizations. Ask an administrator to add you to an existing one.',
};

export function signupErrorMessage(error: unknown): string {
  const message = accountErrorFromError(error);
  if (message) return SIGNUP_ERROR_HELP[message] ?? message;
  return authErrorMessage(error);
}

export interface ResetPasswordInput {
  /** One-time code from the recovery email link. */
  code: string;
  password: string;
  /** Ends every other session — the safe default after a suspected compromise. */
  logoutFromAllDevices?: boolean;
}

/** Finish recovery: exchange the emailed code for a new password. */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const res = await blocksFetch<AccountResponse>(`${IAM_BASE}/auth/reset-password`, {
    method: 'POST',
    body: {
      code: input.code,
      password: input.password,
      logoutFromAllDevices: input.logoutFromAllDevices ?? true,
    },
    noRetry: true,
  });
  assertAccountOk(res);
}

/** Cookie/session logout — capital L, empty `{}` body. Revokes and clears the SSO cookies. */
export async function logout(): Promise<void> {
  await blocksFetch<unknown>(`${IAM_BASE}/auth/Logout`, {
    method: 'POST',
    body: {},
    headers: { accept: 'application/json' },
    noRetry: true, // refreshing a session we're tearing down is pointless
  });
}

export interface ActivateInput {
  /** Invitation token from /activate?code=… */
  code: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Invite-and-activate only — not part of SSO login. Already-activated users never
 * touch this. The invitation code is the credential, so there is no session here.
 */
export async function activate(input: ActivateInput): Promise<unknown> {
  const res = await fetch(`${IAM_BASE}/auth/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-blocks-key': BLOCKS.projectKey },
    body: JSON.stringify({
      captchaCode: '',
      mailPurpose: '',
      preventPostEvent: false,
      ...input,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`activation failed (${res.status}): ${detail || 'no response body'}`);
  }
  return res.json().catch(() => ({}));
}

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Check, Loader2, MailCheck, Plus, UserPlus, X } from 'lucide-react';
import {
  attributeKeyProblem,
  checkOrganizationName,
  coerceAttributeValue,
  emailSignupAllowed,
  getOrganizationConfig,
  getSignupSettings,
  orgSignupAllowed,
  signUp,
  signupErrorMessage,
  signupFailure,
  ORGANIZATION_CONFIG_KEY,
  SIGNUP_ORG_LIMITS,
  SIGNUP_SETTINGS_KEY,
  type SignupOrganization,
} from '@/features/auth/api';
import { AuthScreen } from '@/features/auth/auth-screen';
import { Captcha, useCaptcha } from '@/features/auth/captcha-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

/**
 * Self-service registration, optionally creating an organization in the same call.
 *
 * There is no password field, and that is not an omission: IAM creates the account
 * inactive and mails an activation link, and the password is set on /activate. So this
 * page ends at "check your email" rather than at a session.
 *
 * Two steps when the project allows organizations, one when it does not. The steps are
 * a client-side convenience only — nothing is sent until the end, and IAM keeps no
 * state between them. That matters for the failure path: the org is created before the
 * user and rolled back if the user then fails, so a 400 has persisted *nothing* and the
 * right response is to keep every field exactly as typed.
 */
/** One address as the form holds it — every field a string, primary tracked separately. */
interface AddressRow {
  /** Stable across re-renders so React keys survive a removal from the middle. */
  id: number;
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface AttributeRow {
  id: number;
  key: string;
  value: string;
}

const emptyAddress = (id: number): AddressRow => ({
  id,
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
});

/** An address the user started and abandoned must not be posted as a blank record. */
const addressIsEmpty = (row: AddressRow): boolean =>
  !row.name.trim() &&
  !row.addressLine1.trim() &&
  !row.addressLine2.trim() &&
  !row.city.trim() &&
  !row.state.trim() &&
  !row.postalCode.trim() &&
  !row.country.trim();

/**
 * Form state → the `organization` object IAM accepts.
 *
 * Everything blank is dropped rather than sent empty: the entity has real defaults for
 * several of these, and a blank string would be a value that overwrites nothing useful.
 */
function buildOrganization(
  name: string,
  description: string,
  email: string,
  addresses: AddressRow[],
  attributes: AttributeRow[],
  primaryAddressId: number | null,
): SignupOrganization {
  const filled = addresses.filter((row) => !addressIsEmpty(row));

  const attributeEntries = attributes
    .filter((row) => row.key.trim() && !attributeKeyProblem(row.key))
    .map((row) => [row.key.trim(), coerceAttributeValue(row.value)] as const);

  return {
    name: name.trim(),
    description: description.trim() || undefined,
    email: email.trim() || undefined,
    ...(filled.length > 0
      ? {
          addresses: filled.map((row) => ({
            name: row.name.trim() || undefined,
            addressLine1: row.addressLine1.trim() || undefined,
            addressLine2: row.addressLine2.trim() || undefined,
            city: row.city.trim() || undefined,
            state: row.state.trim() || undefined,
            postalCode: row.postalCode.trim() || undefined,
            country: row.country.trim() || undefined,
            isPrimary: row.id === primaryAddressId,
          })),
        }
      : {}),
    ...(attributeEntries.length > 0
      ? { attributes: Object.fromEntries(attributeEntries) }
      : {}),
  };
}

/**
 * Organization error keys that belong to the name field specifically. Everything else
 * IAM reports about the organization is listed separately, next to nothing in
 * particular — pinning an address error under the name field would just mislead.
 */
const NAME_ERROR_KEYS = new Set(['name_already_exists', 'Name', 'OrganizationName']);

/** "PostalCode" → "Postal code", "Addresses[1].City" → "Address 2 — City". */
function fieldLabel(key: string): string {
  const indexed = /^Addresses\[(\d+)\]\.(\w+)$/.exec(key);
  if (indexed) return `Address ${Number(indexed[1]) + 1} — ${spaceCase(indexed[2])}`;
  // The organization validator and the account validator share this key; by the time
  // it is being labelled we already know which one owns it.
  if (key === 'Email') return 'Organization email';
  return spaceCase(key);
}

const spaceCase = (value: string): string =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function SignupPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [addresses, setAddresses] = useState<AddressRow[]>([emptyAddress(0)]);
  const [primaryAddressId, setPrimaryAddressId] = useState<number | null>(0);
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  /**
   * Row ids only have to be unique within this form. A ref, not state: it is never
   * rendered, and bumping state here would re-render the whole form on every add.
   */
  const nextRowId = useRef(1);

  const [step, setStep] = useState<'details' | 'organization'>('details');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Failure that belongs to the person — shown on the details step. */
  const [error, setError] = useState<string | null>(null);
  /** Failure that belongs to the organization — shown under its name field. */
  const [orgError, setOrgError] = useState<string | null>(null);
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  /** Organization failures that are not about the name, keyed as IAM reported them. */
  const [orgFieldErrors, setOrgFieldErrors] = useState<Record<string, string>>({});

  const captcha = useCaptcha();

  const { data: settings, isPending: loadingSettings } = useQuery({
    queryKey: SIGNUP_SETTINGS_KEY,
    queryFn: getSignupSettings,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Both of these are anonymous endpoints, so they resolve on a cold load. A failed
  // read leaves the org step out rather than offering one IAM would refuse.
  const { data: orgConfig } = useQuery({
    queryKey: ORGANIZATION_CONFIG_KEY,
    queryFn: getOrganizationConfig,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const closed = settings ? !emailSignupAllowed(settings) : false;
  const withOrganization = orgSignupAllowed(orgConfig);

  /**
   * Advisory availability check, run when the name field loses focus.
   *
   * Deliberately never blocks submit: the endpoint can race, and it does not exist on
   * every deployed IAM. A null answer means "no opinion" and leaves the field alone.
   */
  async function onCheckName() {
    const name = orgName.trim();
    if (!name) return;
    const answer = await checkOrganizationName(name);
    if (!answer || answer.isAvailable) {
      // Clear only the clash we may have raised ourselves; a server-side error stands.
      if (answer?.isAvailable) {
        setOrgError(null);
        setNameSuggestions([]);
      }
      return;
    }
    setOrgError('That organization name is taken.');
    setNameSuggestions(answer.suggestions);
  }

  const updateAddress = (id: number, patch: Partial<AddressRow>) =>
    setAddresses((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addAddress = () =>
    setAddresses((rows) => [...rows, emptyAddress(nextRowId.current++)]);

  function removeAddress(id: number) {
    setAddresses((rows) => rows.filter((row) => row.id !== id));
    // Removing the primary leaves none marked rather than silently promoting another.
    if (primaryAddressId === id) setPrimaryAddressId(null);
  }

  const updateAttribute = (id: number, patch: Partial<AttributeRow>) =>
    setAttributes((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addAttribute = () =>
    setAttributes((rows) => [...rows, { id: nextRowId.current++, key: '', value: '' }]);

  const removeAttribute = (id: number) =>
    setAttributes((rows) => rows.filter((row) => row.id !== id));

  /**
   * Attribute keys IAM would refuse, plus duplicates.
   *
   * Both matter because neither is an error server-side — the normalizer drops a bad
   * key and the last duplicate wins — so without stopping here the user would submit
   * successfully and quietly lose data.
   */
  const attributeProblems = new Map<number, string>();
  const seenKeys = new Map<string, number>();
  for (const row of attributes) {
    const key = row.key.trim();
    if (!key) continue;
    const problem = attributeKeyProblem(key);
    if (problem) {
      attributeProblems.set(row.id, problem);
      continue;
    }
    const firstSeen = seenKeys.get(key);
    if (firstSeen !== undefined) attributeProblems.set(row.id, 'Already used above.');
    else seenKeys.set(key, row.id);
  }

  function onContinue(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStep('organization');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setOrgError(null);
    setOrgFieldErrors({});
    setNameSuggestions([]);
    try {
      await signUp({
        email: email.trim(),
        firstName,
        lastName,
        phoneNumber,
        captchaCode: captcha.code || undefined,
        ...(withOrganization
          ? {
              organization: buildOrganization(
                orgName,
                orgDescription,
                orgEmail,
                addresses,
                attributes,
                primaryAddressId,
              ),
            }
          : {}),
      });
      setDone(true);
    } catch (e) {
      const failure = signupFailure(e);

      // Route the message to the step that can act on it. A taken name is fixable
      // right here; a registered email means going back a step.
      if (failure?.isOrganizationError) {
        const entries = Object.entries(failure.errors);
        const named = entries.find(([key]) => NAME_ERROR_KEYS.has(key));
        setOrgError(named ? named[1] : null);
        setOrgFieldErrors(
          Object.fromEntries(entries.filter(([key]) => !NAME_ERROR_KEYS.has(key))),
        );
        setNameSuggestions(failure.nameSuggestions);
        setStep('organization');
      } else {
        setError(failure?.message ?? signupErrorMessage(e));
        setStep('details');
      }

      // Spent either way — a rejected submit needs a fresh challenge.
      captcha.handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthScreen
        icon={MailCheck}
        tone="success"
        title="Check your email"
        description={
          <>
            We sent an activation link to{' '}
            <span className="font-medium text-foreground">{email}</span>. Open it to choose a
            password and finish setting up your account.
          </>
        }
        backTo="/login"
      >
        <p className="rounded-md border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
          {withOrganization ? (
            <>
              <span className="font-medium text-foreground">{orgName.trim()}</span> is ready and
              waiting for you. Until the link is used, the account exists but cannot sign in.
            </>
          ) : (
            <>The link opens the activation page. Until it is used, the account exists but cannot sign in.</>
          )}
        </p>
      </AuthScreen>
    );
  }

  if (closed) {
    return (
      <AuthScreen
        icon={UserPlus}
        title="Sign-up is closed"
        description="This project is not accepting new accounts right now. An administrator can invite you instead."
        backTo="/login"
      />
    );
  }

  // ── Step 2: the organization ────────────────────────────────────────────────
  if (step === 'organization') {
    return (
      <AuthScreen
        icon={Building2}
        title="Set up your organization"
        description="Your workspace on this project. Only the name is required — the rest can wait."
        wide
      >
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="orgName" className="text-sm font-medium">
              Organization name
            </label>
            <Input
              id="orgName"
              required
              autoFocus
              maxLength={SIGNUP_ORG_LIMITS.name}
              placeholder="Acme Inc."
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                // Whatever was wrong applied to the old name.
                setOrgError(null);
                setNameSuggestions([]);
              }}
              onBlur={onCheckName}
              disabled={busy}
              aria-invalid={orgError != null}
              aria-describedby={orgError ? 'orgName-error' : undefined}
            />
            {orgError && (
              <p
                id="orgName-error"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {orgError}
              </p>
            )}
            {nameSuggestions.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground">Available instead:</p>
                <div className="flex flex-wrap gap-2">
                  {nameSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setOrgName(suggestion);
                        setOrgError(null);
                        setNameSuggestions([]);
                      }}
                      className="rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor="orgDescription" className="text-sm font-medium">
                Description
              </label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <Input
              id="orgDescription"
              maxLength={SIGNUP_ORG_LIMITS.description}
              placeholder="What your team does"
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <label htmlFor="orgEmail" className="text-sm font-medium">
                Organization email
              </label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <Input
              id="orgEmail"
              type="email"
              placeholder="billing@acme.com"
              value={orgEmail}
              onChange={(e) => setOrgEmail(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Where the organization is contacted — separate from your own address.
            </p>
          </div>

          {/* ── Addresses ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Addresses</span>
              <span className="text-xs text-muted-foreground">
                Optional · up to {SIGNUP_ORG_LIMITS.maxAddresses}
              </span>
            </div>

            {addresses.map((row, index) => (
              <div key={row.id} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="primary-address"
                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      checked={primaryAddressId === row.id}
                      onChange={() => setPrimaryAddressId(row.id)}
                      disabled={busy}
                    />
                    Address {index + 1} · primary
                  </label>
                  {addresses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeAddress(row.id)}
                      disabled={busy}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      aria-label={`Remove address ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Input
                  placeholder="Label — HQ, Billing…"
                  maxLength={SIGNUP_ORG_LIMITS.addressName}
                  value={row.name}
                  onChange={(e) => updateAddress(row.id, { name: e.target.value })}
                  disabled={busy}
                />
                <Input
                  placeholder="Address line 1"
                  maxLength={SIGNUP_ORG_LIMITS.addressLine}
                  value={row.addressLine1}
                  onChange={(e) => updateAddress(row.id, { addressLine1: e.target.value })}
                  disabled={busy}
                />
                <Input
                  placeholder="Address line 2"
                  maxLength={SIGNUP_ORG_LIMITS.addressLine}
                  value={row.addressLine2}
                  onChange={(e) => updateAddress(row.id, { addressLine2: e.target.value })}
                  disabled={busy}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="City"
                    maxLength={SIGNUP_ORG_LIMITS.city}
                    value={row.city}
                    onChange={(e) => updateAddress(row.id, { city: e.target.value })}
                    disabled={busy}
                  />
                  <Input
                    placeholder="State / region"
                    maxLength={SIGNUP_ORG_LIMITS.state}
                    value={row.state}
                    onChange={(e) => updateAddress(row.id, { state: e.target.value })}
                    disabled={busy}
                  />
                  <Input
                    placeholder="Postal code"
                    maxLength={SIGNUP_ORG_LIMITS.postalCode}
                    value={row.postalCode}
                    onChange={(e) => updateAddress(row.id, { postalCode: e.target.value })}
                    disabled={busy}
                  />
                  <Input
                    placeholder="Country"
                    maxLength={SIGNUP_ORG_LIMITS.country}
                    value={row.country}
                    onChange={(e) => updateAddress(row.id, { country: e.target.value })}
                    disabled={busy}
                  />
                </div>
              </div>
            ))}

            {addresses.length < SIGNUP_ORG_LIMITS.maxAddresses && (
              <Button type="button" variant="outline" size="sm" onClick={addAddress} disabled={busy}>
                <Plus className="h-3.5 w-3.5" />
                Add address
              </Button>
            )}
          </div>

          {/* ── Attributes ────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Custom attributes</span>
              <span className="text-xs text-muted-foreground">
                Optional · up to {SIGNUP_ORG_LIMITS.maxAttributes}
              </span>
            </div>

            {attributes.map((row) => {
              const problem = attributeProblems.get(row.id);
              return (
                <div key={row.id} className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Input
                      placeholder="Name"
                      maxLength={SIGNUP_ORG_LIMITS.attributeKey}
                      className="flex-1"
                      value={row.key}
                      onChange={(e) => updateAttribute(row.id, { key: e.target.value })}
                      disabled={busy}
                      aria-invalid={problem != null}
                    />
                    <Input
                      placeholder="Value"
                      maxLength={SIGNUP_ORG_LIMITS.attributeValue}
                      className="flex-1"
                      value={row.value}
                      onChange={(e) => updateAttribute(row.id, { value: e.target.value })}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => removeAttribute(row.id)}
                      disabled={busy}
                      className="mt-2.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      aria-label="Remove attribute"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {problem && <p className="text-xs text-destructive">{problem}</p>}
                </div>
              );
            })}

            {attributes.length < SIGNUP_ORG_LIMITS.maxAttributes && (
              <Button type="button" variant="outline" size="sm" onClick={addAttribute} disabled={busy}>
                <Plus className="h-3.5 w-3.5" />
                Add attribute
              </Button>
            )}

            {attributes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Saved as text. A plain number or true/false is stored as one — anything with a
                leading zero stays text, so postal codes survive.
              </p>
            )}
          </div>

          {captcha.enabled && <Captcha {...captcha.props} className="flex justify-center" />}

          {Object.keys(orgFieldErrors).length > 0 && (
            <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {Object.entries(orgFieldErrors).map(([key, message]) => (
                <p key={key}>
                  <span className="font-medium">{fieldLabel(key)}:</span> {message}
                </p>
              ))}
            </div>
          )}

          {(error ?? captcha.loadError) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error ?? captcha.loadError}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={
              busy || captcha.blocking || orgName.trim().length === 0 || attributeProblems.size > 0
            }
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating your account…
              </>
            ) : (
              'Create account'
            )}
          </Button>

          <button
            type="button"
            onClick={() => setStep('details')}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to your details
          </button>
        </form>
      </AuthScreen>
    );
  }

  // ── Step 1: the person ──────────────────────────────────────────────────────
  return (
    <AuthScreen
      icon={UserPlus}
      title="Create your account"
      description={
        withOrganization
          ? "First, tell us who you are. Next you'll name your organization."
          : "We'll email you a link to set your password and finish up."
      }
      backTo="/login"
      backLabel="Already have an account? Sign in"
    >
      <form className="space-y-4" onSubmit={withOrganization ? onContinue : onSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm font-medium">
              First name
            </label>
            <Input
              id="firstName"
              autoComplete="given-name"
              autoFocus
              placeholder="Ada"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium">
              Last name
            </label>
            <Input
              id="lastName"
              autoComplete="family-name"
              placeholder="Lovelace"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="phoneNumber" className="text-sm font-medium">
              Phone number
            </label>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <Input
            id="phoneNumber"
            type="tel"
            autoComplete="tel"
            placeholder="+41 79 000 00 00"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            disabled={busy}
          />
        </div>

        {/* The challenge belongs to whichever step actually submits. */}
        {!withOrganization && captcha.enabled && (
          <Captcha {...captcha.props} className="flex justify-center" />
        )}

        {(error ?? (withOrganization ? null : captcha.loadError)) && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error ?? captcha.loadError}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={busy || (!withOrganization && captcha.blocking)}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating your account…
            </>
          ) : withOrganization ? (
            'Continue'
          ) : (
            'Create account'
          )}
        </Button>

        {withOrganization && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Step 1 of 2 — nothing is created until you finish.
          </p>
        )}

        {loadingSettings && (
          <p className="text-center text-xs text-muted-foreground">Checking sign-up options…</p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Already invited?{' '}
          <Link to="/login" className="underline-offset-4 hover:text-foreground hover:underline">
            Use the link in your invitation email
          </Link>
          .
        </p>
      </form>
    </AuthScreen>
  );
}

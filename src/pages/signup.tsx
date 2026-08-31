import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Check, Loader2, MailCheck, UserPlus } from 'lucide-react';
import {
  checkOrganizationName,
  emailSignupAllowed,
  getOrganizationConfig,
  getSignupSettings,
  orgSignupAllowed,
  signUp,
  signupErrorMessage,
  signupFailure,
  ORGANIZATION_CONFIG_KEY,
  SIGNUP_SETTINGS_KEY,
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
export function SignupPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');

  const [step, setStep] = useState<'details' | 'organization'>('details');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Failure that belongs to the person — shown on the details step. */
  const [error, setError] = useState<string | null>(null);
  /** Failure that belongs to the organization — shown under its name field. */
  const [orgError, setOrgError] = useState<string | null>(null);
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);

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
              organization: {
                name: orgName.trim(),
                description: orgDescription.trim() || undefined,
              },
            }
          : {}),
      });
      setDone(true);
    } catch (e) {
      const failure = signupFailure(e);

      // Route the message to the step that can act on it. A taken name is fixable
      // right here; a registered email means going back a step.
      if (failure?.isOrganizationError) {
        setOrgError(failure.message);
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
        title="Name your organization"
        description="Your workspace on this project. You can rename it later."
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
              maxLength={150}
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
              maxLength={500}
              placeholder="What your team does"
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
              disabled={busy}
            />
          </div>

          {captcha.enabled && <Captcha {...captcha.props} className="flex justify-center" />}

          {(error ?? captcha.loadError) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error ?? captcha.loadError}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={busy || captcha.blocking || orgName.trim().length === 0}
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

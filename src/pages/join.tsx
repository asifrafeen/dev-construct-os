import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import {
  completeSignupLinkMfa,
  getSignupLinkContext,
  joinErrorMessage,
  readLinkCode,
  redeemOutcome,
  redeemSignupLink,
  type RedeemSignupLinkResponse,
  type SignupLinkContext,
  type SignupLinkMode,
} from '@/features/auth/signup-link';
import { AuthScreen } from '@/features/auth/auth-screen';
import { ME_KEY } from '@/features/users/hooks';
import { markSignedIn } from '@/state/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

/**
 * Landing page for a one-click signup link — `https://<app>/join#link=<code>`.
 *
 * Implicit by design: the click on the emailed link *is* the one click. Nothing here
 * asks the invitee to confirm, because there is nothing for them to decide — the
 * administrator already chose the roles, and a confirm button would only be a second
 * click on the way to the same place.
 *
 * Redeeming is a POST issued from JavaScript, so a link scanner that follows the URL
 * does not spend the code; it never gets as far as running this.
 *
 * Two of the four branches leave this page: OIDC hands the browser an authorize URL
 * that returns to /login/callback, and PasswordRequired sends the invitee to /activate
 * to choose a password. Embedded finishes here, and MFA finishes here after a code.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [context, setContext] = useState<SignupLinkContext | null>(null);
  const [mfaId, setMfaId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // React 19 runs effects twice in development. The code is single-use, so the second
  // run would redeem an already-spent link and report a valid invitation as invalid.
  const ran = useRef(false);

  /**
   * Finishes a redemption locally: the cookie is already set by the time we get here.
   *
   * The link exists to put the invitee on a particular page, so landing on the app's default
   * would defeat the point. OIDC carries that path on the authorize redirect; embedded has no
   * redirect, so it comes back in the token body.
   */
  async function land(forwardedTo: string | null) {
    markSignedIn();
    await qc.invalidateQueries({ queryKey: ME_KEY });
    navigate(forwardedTo ?? '/', { replace: true });
  }

  /**
   * `mode` is passed in rather than read from state: the first call happens inside the
   * mount effect, in the same tick as setContext, where the `context` closure is still null.
   */
  async function apply(res: RedeemSignupLinkResponse, mode?: SignupLinkMode) {
    const outcome = redeemOutcome(res);
    switch (outcome.kind) {
      case 'signed-in':
        return land(outcome.forwardedTo);
      case 'navigate':
        // A full navigation, not a router push: the URL is IAM's, not this app's.
        window.location.assign(outcome.url);
        return;
      case 'activate': {
        // `join` tells the activation page this came from an invitation rather than an
        // ordinary portal invite, and in which mode — an OIDC one can continue straight
        // into the app afterwards on the link-session cookie activation leaves behind.
        const params = new URLSearchParams({ code: outcome.activationKey });
        if (mode) params.set('join', mode);
        navigate(`/activate?${params}`, { replace: true });
        return;
      }
      case 'mfa':
        setMfaId(outcome.mfaId);
        return;
      case 'error':
        setError(joinErrorMessage(outcome.error));
    }
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = readLinkCode();
    if (!code) {
      setError(joinErrorMessage('invalid_link'));
      return;
    }

    // Context first: it names the application for the screen below, and it tells an
    // expired or withdrawn link apart from a working one without spending anything.
    getSignupLinkContext(code)
      .then((ctx) => {
        setContext(ctx);
        if (!ctx.valid) {
          setError(joinErrorMessage('invalid_link'));
          return;
        }
        return redeemSignupLink(code).then((res) => apply(res, ctx.mode));
      })
      .catch(() => setError(joinErrorMessage('invalid_link')));
    // Runs once, guarded by `ran` — the deps its body closes over are all stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onVerifyMfa(event: FormEvent) {
    event.preventDefault();
    if (!mfaId) return;

    setBusy(true);
    setError(null);
    try {
      await apply(await completeSignupLinkMfa(mfaId, mfaCode.trim()), context?.mode);
    } catch {
      setError('That code was not accepted. Check it and try again.');
      setMfaCode('');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AuthScreen
        icon={ShieldAlert}
        tone="destructive"
        title="This invitation didn't work"
        description={error}
        backTo="/login"
      />
    );
  }

  if (mfaId) {
    return (
      <AuthScreen
        icon={KeyRound}
        title="Confirm it's you"
        description="You already have an account here, so finish with the verification code for it."
      >
        <form onSubmit={onVerifyMfa} className="space-y-3">
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Verification code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={busy || !mfaCode.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </form>
      </AuthScreen>
    );
  }

  const appName = context?.applicationName;
  const greeting = context?.firstName ? `Hi ${context.firstName} — ` : '';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Blocks className="h-6 w-6 text-primary" />
      </span>
      <div className="space-y-1 text-center">
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {appName ? `${greeting}setting up your access to ${appName}…` : 'Opening your invitation…'}
        </p>
        {context?.maskedEmail && (
          <p className="text-xs text-muted-foreground">{context.maskedEmail}</p>
        )}
      </div>
    </div>
  );
}

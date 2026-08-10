import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, Loader2, ShieldAlert, UserPlus } from 'lucide-react';
import {
  finishSocialLogin,
  pendingProviderName,
  restartSocialLogin,
  signUpWithSso,
  unknownUserEmail,
} from '@/features/auth/embedded';
import { authErrorMessage } from '@/features/auth/errors';
import { ME_KEY } from '@/features/users/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

/**
 * Where Google/Microsoft return the browser in the embedded flow. This path is
 * what has to be registered on the provider AND on the Blocks identity provider.
 */
export function SocialCallbackPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  /** Set when the identity is valid but has no account here yet. */
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [signingUp, setSigningUp] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const ran = useRef(false); // React 19 runs effects twice in dev — the code is single-use

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    finishSocialLogin(window.location.search)
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ME_KEY });
        navigate('/', { replace: true });
      })
      .catch((e) => {
        const email = unknownUserEmail(e);
        if (email) setNewEmail(email);
        else setError(authErrorMessage(e));
      });
  }, [navigate, qc]);

  /**
   * Create the membership, then replay the provider round-trip — the original
   * code and state were consumed by the failed attempt and cannot be reused.
   */
  async function createAccount(event: FormEvent) {
    event.preventDefault();
    const provider = pendingProviderName();
    if (!newEmail || !provider) {
      setError('That sign-in attempt has expired. Start again from the sign-in page.');
      return;
    }

    setSigningUp(true);
    try {
      await signUpWithSso(newEmail, provider, { firstName, lastName });
      await restartSocialLogin(provider);
    } catch (e) {
      setError(authErrorMessage(e));
      setSigningUp(false);
    }
  }

  if (newEmail != null && error == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <form className="w-full max-w-sm space-y-5" onSubmit={createAccount}>
          <div className="space-y-3 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <UserPlus className="h-6 w-6 text-primary" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You signed in as <span className="font-medium text-foreground">{newEmail}</span>, which
              doesn&rsquo;t have a Construct OS account yet.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="firstName" className="text-sm font-medium">
                First name
              </label>
              <Input
                id="firstName"
                autoComplete="given-name"
                required
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={signingUp}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="lastName" className="text-sm font-medium">
                Last name
              </label>
              <Input
                id="lastName"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={signingUp}
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={signingUp}>
            {signingUp ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating your account…
              </>
            ) : (
              'Create account and continue'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={signingUp}
            onClick={() => navigate('/login', { replace: true })}
          >
            Cancel
          </Button>
        </form>
      </div>
    );
  }

  if (error != null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-5 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">Sign-in didn&rsquo;t complete</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
          </div>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Blocks className="h-6 w-6 text-primary" />
      </span>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Completing sign-in…
      </p>
    </div>
  );
}

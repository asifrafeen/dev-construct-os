import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { resetPassword } from '@/features/auth/api';
import { authErrorMessage } from '@/features/auth/errors';
import { AuthScreen } from '@/features/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

/** Client-side floor only — the project's real policy is enforced by IAM. */
const MIN_LENGTH = 8;

/**
 * Landing page for the link in the recovery email. The code arrives as `?code=`.
 *
 * IAM builds that link's path from its own config — `oidc/recover/<tenantId>` when the
 * project is OIDC-enabled, otherwise the configured RecoverAccountPath — so this page
 * is mounted at several routes and only ever reads the query string.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError('The two passwords do not match.');

    setBusy(true);
    setError(null);
    try {
      // Ending other sessions is the right default here: recovery is exactly the
      // case where someone else may be holding a live session.
      await resetPassword({ code, password, logoutFromAllDevices: true });
      setDone(true);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!code) {
    return (
      <AuthScreen
        icon={ShieldAlert}
        tone="destructive"
        title="This link is incomplete"
        description="It's missing its reset code. Request a new link and open it directly from the email."
        backTo="/forgot-password"
        backLabel="Request a new link"
      />
    );
  }

  if (done) {
    return (
      <AuthScreen
        icon={CheckCircle2}
        tone="success"
        title="Password updated"
        description="You've been signed out everywhere else. Sign in with your new password."
      >
        <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
          Continue to sign in
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      icon={KeyRound}
      title="Choose a new password"
      description="Pick something you don't use anywhere else."
      backTo="/login"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          {mismatch && <p className="text-xs text-destructive">The two passwords do not match.</p>}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || mismatch}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </>
          ) : (
            'Set new password'
          )}
        </Button>
      </form>
    </AuthScreen>
  );
}

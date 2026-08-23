import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, MailCheck } from 'lucide-react';
import { recoverAccount } from '@/features/auth/api';
import { authErrorMessage } from '@/features/auth/errors';
import { AuthScreen } from '@/features/auth/auth-screen';
import { Captcha, useCaptcha } from '@/features/auth/captcha-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Renders a challenge only when the project configured one; otherwise the form is
  // exactly as it was. Recovery is unauthenticated and emails a real person, so it is
  // the endpoint most worth rate-limiting behind a challenge.
  const captcha = useCaptcha();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recoverAccount(email.trim(), captcha.code || undefined);
      setSent(true);
    } catch (e) {
      setError(authErrorMessage(e));
      // The code is spent whether or not IAM accepted it — never offer a replay.
      captcha.handleError(e);
    } finally {
      setBusy(false);
    }
  }

  // Deliberately identical whether or not the address has an account — IAM answers
  // the same either way, and saying "no such user" would leak who is registered.
  if (sent) {
    return (
      <AuthScreen
        icon={MailCheck}
        tone="success"
        title="Check your email"
        description={
          <>
            If <span className="font-medium text-foreground">{email}</span> has an account, a
            password reset link is on its way. The link expires, so use it soon.
          </>
        }
        backTo="/login"
      >
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setSent(false);
            // Going round again needs a fresh challenge — the last one is used up.
            captcha.reset();
          }}
        >
          Use a different address
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      icon={KeyRound}
      title="Reset your password"
      description="Enter the email address on your account and we'll send you a link to set a new password."
      backTo="/login"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        {captcha.enabled && <Captcha {...captcha.props} className="flex justify-center" />}

        {(error ?? captcha.loadError) && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error ?? captcha.loadError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={busy || captcha.blocking}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            'Send reset link'
          )}
        </Button>
      </form>
    </AuthScreen>
  );
}

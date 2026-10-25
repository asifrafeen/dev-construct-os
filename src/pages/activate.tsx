import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  activate,
  activatedWithSession,
  safeForwardedTo,
  type ActivateResult,
} from '@/features/auth/api';
import { startLogin } from '@/features/auth/sso';
import { ME_KEY } from '@/features/users/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input } from '@/components/ui/misc';

/**
 * Invite-and-activate only. Users who are already active go straight through SSO and
 * never see this page; it exists for accounts created via the portal or IAM API.
 *
 * Three ways out, in order of preference:
 *
 *  1. The response carries a session. A signup-link configuration with
 *     `signInAfterActivation` set answers activation with tokens in cookies, so the
 *     invitee is already signed in — land them, on the link's `forwardedTo` if it sent
 *     one. Works the same for both link modes.
 *  2. `?join=Oidc` without that flag. Activation still leaves the restricted
 *     link-session cookie behind, and /oidc/authorize spends it without a prompt, so
 *     starting the SSO flow gets them in silently.
 *  3. Anything else — an ordinary invite, or an embedded link whose configuration does
 *     not sign in — goes to the sign-in page, as it always has.
 */
export function ActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const code = useMemo(() => params.get('code') ?? '', [params]);
  const continueSilently = params.get('join') === 'Oidc';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => activate({ code, password, firstName, lastName }),
    onSuccess: async (res: ActivateResult) => {
      // An MFA account gets a challenge instead of a session, at HTTP 200 in the error
      // slot — so this has to be checked before anything treats the call as finished.
      // This page has no way to answer one, so say so rather than silently sending them
      // to a login form as if activation had simply completed.
      if (res.mfa_required || res.mfa_id) {
        setNotice(
          'Your password is set. This account also uses a verification step, so finish by signing in.',
        );
        return;
      }

      if (activatedWithSession(res)) {
        await qc.invalidateQueries({ queryKey: ME_KEY });
        navigate(safeForwardedTo(res.forwardedTo) ?? '/', { replace: true });
        return;
      }

      if (continueSilently) {
        // startLogin navigates away and never resolves, so nothing below runs on success.
        // If it throws — misconfigured client id, initiate refused — fall through to the
        // sign-in page rather than stranding the invitee on a form that already succeeded.
        try {
          await startLogin();
          return;
        } catch {
          /* fall through */
        }
      }

      navigate('/login', { replace: true });
    },
  });

  if (notice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account activated</CardTitle>
            <CardDescription>{notice}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
              Continue to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!code) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-destructive">
          Missing invitation token — open the link from your invite email.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Activate your account</CardTitle>
          <CardDescription>Set a password to finish setting up your Blocks account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              // Confirm-password is UI-only; only call activate once they match.
              if (password !== confirmPassword) {
                setMismatch(true);
                return;
              }
              setMismatch(false);
              m.mutate();
            }}
          >
            <Input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {mismatch && <p className="text-sm text-destructive">Passwords do not match.</p>}
            <Button className="w-full" disabled={m.isPending}>
              {m.isPending ? 'Activating…' : 'Activate account'}
            </Button>
            {m.isError && <ErrorNote error={m.error} />}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

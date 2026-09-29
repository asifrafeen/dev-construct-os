import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { activate } from '@/features/auth/api';
import { startLogin } from '@/features/auth/sso';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input } from '@/components/ui/misc';

/**
 * Invite-and-activate only. Users who are already active go straight through SSO and
 * never see this page; it exists for accounts created via the portal or IAM API.
 *
 * `?join=Oidc` marks an arrival from a one-click signup link in PasswordRequired mode.
 * Activating such a code also mints the restricted link-session cookie, and
 * /oidc/authorize honours it — so the invitee can be carried straight into the app
 * instead of being asked for the password they set a moment ago.
 *
 * `?join=Embedded` gets today's behaviour: that cookie is keyed to the link's OIDC
 * client, embedded links have none, and authorize would simply show the login form.
 */
export function ActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = useMemo(() => params.get('code') ?? '', [params]);
  const continueSilently = params.get('join') === 'Oidc';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const m = useMutation({
    mutationFn: () => activate({ code, password, firstName, lastName }),
    onSuccess: async () => {
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

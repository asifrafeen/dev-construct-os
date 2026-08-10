import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { activate } from '@/features/auth/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input } from '@/components/ui/misc';

/**
 * Invite-and-activate only. Users who are already active go straight through SSO and
 * never see this page; it exists for accounts created via the portal or IAM API.
 */
export function ActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = useMemo(() => params.get('code') ?? '', [params]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const m = useMutation({
    mutationFn: () => activate({ code, password, firstName, lastName }),
    onSuccess: () => navigate('/login', { replace: true }),
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

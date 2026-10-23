import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { accountErrorMessage } from '@/features/auth/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input } from '@/components/ui/misc';
import { Field } from '@/components/ui/modal';
import { security } from './api';

/** Change the signed-in user's password, checked live against the project's policy. */
export function ChangePasswordCard() {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [policyOk, setPolicyOk] = useState<boolean | null>(null);
  const change = useMutation({
    mutationFn: async () => {
      const res = await security.changePassword(oldPassword, newPassword);
      const err = accountErrorMessage(res);
      if (err) throw new Error(err);
      return res;
    },
    onSuccess: () => {
      setOld('');
      setNew('');
      setConfirm('');
    },
  });

  // Live policy feedback, debounced so each keystroke isn't a request.
  useEffect(() => {
    if (!newPassword) {
      setPolicyOk(null);
      return;
    }
    const t = setTimeout(() => {
      security
        .passwordCheck(newPassword)
        .then((ok) => setPolicyOk(ok === true || (ok as unknown) === 'true'))
        .catch(() => setPolicyOk(null));
    }, 400);
    return () => clearTimeout(t);
  }, [newPassword]);

  const mismatch = !!confirm && confirm !== newPassword;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Change password
        </CardTitle>
        <CardDescription>
          A wrong current password counts toward lockout. If the project logs out on password change, this session ends too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
          </Field>
          <Field
            label="New password"
            hint={
              policyOk === null ? 'Checked live against the project policy.' : policyOk ? (
                <span className="text-emerald-600">Meets the password policy.</span>
              ) : (
                <span className="text-destructive">Does not meet the password policy.</span>
              )
            }
          >
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </Field>
          <Field label="Confirm new password" hint={mismatch ? <span className="text-destructive">Doesn't match.</span> : undefined}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button disabled={!oldPassword || !newPassword || mismatch || policyOk === false || change.isPending}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
          {change.isSuccess && <p className="text-sm text-emerald-600">Password changed.</p>}
          {change.isError && <ErrorNote error={change.error} />}
        </form>
      </CardContent>
    </Card>
  );
}

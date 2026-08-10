import { useEffect, useState } from 'react';
import { useMe, useUpdateMe } from '@/features/users/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input, Spinner } from '@/components/ui/misc';

export function ProfilePage() {
  const { data: me, isPending } = useMe();
  const update = useUpdateMe();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Seed the form once /iam/me lands (and again if the cached user changes).
  useEffect(() => {
    if (!me) return;
    setFirstName(me.firstName ?? '');
    setLastName(me.lastName ?? '');
    setPhoneNumber(me.phoneNumber ?? '');
  }, [me]);

  if (isPending) return <Spinner />;
  if (!me) return <ErrorNote error="No session" />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">PATCH /iam/v4/iam/me</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
          <CardDescription>
            Email is managed by IAM and can't be changed from here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ firstName, lastName, phoneNumber });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">First name</span>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Last name</span>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Phone number</span>
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Email</span>
              <Input value={me.email} readOnly disabled />
            </label>

            <div className="flex items-center gap-3">
              <Button disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {update.isSuccess && <span className="text-sm text-emerald-600">Saved</span>}
            </div>

            {update.isError && <ErrorNote error={update.error} />}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

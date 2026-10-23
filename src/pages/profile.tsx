import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, Clock, Shield, Smartphone } from 'lucide-react';
import { useUploadFile } from '@/features/files/hooks';
import { useI18n } from '@/features/localization/i18n';
import { languageCode, languageLabel } from '@/features/localization/api';
import { Select } from '@/components/ui/form';
import { useMe, useUpdateMe } from '@/features/users/hooks';
import type { Me } from '@/features/users/api';
import { MfaCard } from '@/features/auth/mfa-card';
import { ChangePasswordCard } from '@/features/security/change-password-card';
import { SessionList } from '@/features/security/session-list';
import { ActivityHistory } from '@/features/security/activity-history';
import { PageHeader, Tabs } from '@/components/ui/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNote, Input, Spinner } from '@/components/ui/misc';

type Tab = 'security' | 'sessions' | 'history';

const TABS: { value: Tab; label: React.ReactNode }[] = [
  { value: 'security', label: <TabLabel icon={Shield}>Security</TabLabel> },
  { value: 'sessions', label: <TabLabel icon={Smartphone}>Sessions</TabLabel> },
  { value: 'history', label: <TabLabel icon={Clock}>History</TabLabel> },
];

function TabLabel({ icon: Icon, children }: { icon: typeof Shield; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

/**
 * Laid out like blocks-iam's own profile: the editable details on the left, and on the
 * right Security (two-step verification, password), Sessions (the devices signed in, each
 * of which can be signed out) and History (the account's activity log). The tab lives in
 * the URL, so /profile?tab=sessions links straight to it.
 */
export function ProfilePage() {
  const { data: me, isPending } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'security';

  if (isPending) return <Spinner />;
  if (!me) return <ErrorNote error="No session" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Your details, account security, the devices you're signed in on and your account history."
        endpoints={[
          'POST /iam/v4/iam/me',
          'POST /iam/v4/mfa/*',
          'POST /iam/v4/auth/change-password',
          'GET /iam/v4/security/sessions',
          'POST /iam/v4/security/sessions/{id}/revoke',
          'POST /iam/v4/security/activity',
        ]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <DetailsCard me={me} />
        <div className="min-w-0 space-y-4">
          <Tabs<Tab> value={tab} onChange={(next) => setParams({ tab: next }, { replace: true })} tabs={TABS} />
          {tab === 'security' && (
            <div className="space-y-4">
              <MfaCard me={me} />
              <ChangePasswordCard />
            </div>
          )}
          {tab === 'sessions' && <SessionList />}
          {tab === 'history' && <ActivityHistory />}
        </div>
      </div>
    </div>
  );
}

function DetailsCard({ me }: { me: Me }) {
  const update = useUpdateMe();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [salutation, setSalutation] = useState('');
  const [language, setLanguage] = useState('');
  const { languages } = useI18n();
  // Public so the stored URL keeps working as an <img src>; private URLs are pre-signed
  // and expire.
  const photo = useUploadFile({ accessModifier: 'Public' });

  // Seed the form once /iam/me lands (and again if the cached user changes).
  useEffect(() => {
    if (!me) return;
    setFirstName(me.firstName ?? '');
    setLastName(me.lastName ?? '');
    setPhoneNumber(me.phoneNumber ?? '');
    setSalutation(me.salutation ?? '');
    setLanguage(me.language ?? '');
  }, [me]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your details</CardTitle>
        <CardDescription>
          Email is managed by IAM and can't be changed from here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          {me.profileImageUrl ? (
            <img src={me.profileImageUrl} alt="" className="h-16 w-16 rounded-full border object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Camera className="h-5 w-5" />
            </div>
          )}
          <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            {photo.isPending ? 'Uploading…' : 'Change photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={photo.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                // Upload to DMS, then point the profile at the stored file. The other
                // fields ride along in case the update replaces rather than merges.
                photo.mutate(file, {
                  onSuccess: (rec) =>
                    update.mutate({
                      firstName: me.firstName,
                      lastName: me.lastName,
                      phoneNumber: me.phoneNumber,
                      profileImageId: rec.fileId ?? rec.itemId,
                      profileImageUrl: rec.url,
                    }),
                });
              }}
            />
          </label>
          {photo.isError && <ErrorNote error={photo.error} />}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              firstName,
              lastName,
              phoneNumber,
              ...(salutation ? { salutation } : {}),
              ...(language ? { language } : {}),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">First name</span>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Last name</span>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Salutation</span>
              <Select value={salutation} onChange={(e) => setSalutation(e.target.value)}>
                <option value="">—</option>
                {['Mr', 'Ms', 'Mrs', 'Mx', 'Dr'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Preferred language</span>
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">—</option>
                {languages.map((l) => (
                  <option key={languageCode(l)} value={languageCode(l)}>
                    {languageLabel(l)}
                  </option>
                ))}
              </Select>
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
  );
}

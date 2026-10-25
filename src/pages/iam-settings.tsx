import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react';
import {
  firstArray,
  iamSettings,
  ORG_CONFIG_KEYS,
  pick,
  type ClientCredential,
  type MfaPolicyInput,
  type OrgConfigAdmin,
  type SignupSettings,
} from '@/features/iam-settings/api';
import { useActiveOrg } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, splitList } from '@/components/ui/form';
import { JsonView, PageHeader, Tabs } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

type Tab = 'signup' | 'orgs' | 'mfa' | 'credentials' | 'providers' | 'config';

export function IamSettingsPage() {
  const [tab, setTab] = useState<Tab>('signup');
  return (
    <div className="space-y-6">
      <PageHeader
        title="IAM settings"
        description="Project-wide identity configuration. Each section needs its own blocks-iam admin permission."
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'signup', label: 'Sign-up policy' },
          { value: 'orgs', label: 'Organizations' },
          { value: 'mfa', label: 'MFA policy' },
          { value: 'credentials', label: 'Client credentials' },
          { value: 'providers', label: 'Identity providers' },
          { value: 'config', label: 'Auth config & OIDC' },
        ]}
      />
      {tab === 'signup' && <SignupTab />}
      {tab === 'orgs' && <OrgConfigTab />}
      {tab === 'mfa' && <MfaPolicyTab />}
      {tab === 'credentials' && <CredentialsTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'config' && <ConfigTab />}
    </div>
  );
}

function Saved({ ok }: { ok: boolean }) {
  return ok ? <span className="text-sm text-emerald-600">Saved</span> : null;
}

function SignupTab() {
  const q = useQuery({ queryKey: ['iam', 'settings', 'signup'], queryFn: iamSettings.signupAdmin, retry: false });
  const [s, setS] = useState<SignupSettings | null>(null);
  const [roles, setRoles] = useState('');
  const [perms, setPerms] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setS({
      isEmailPasswordSignUpEnabled: !!q.data.isEmailPasswordSignUpEnabled,
      isSSoSignUpEnabled: !!q.data.isSSoSignUpEnabled,
      defaultRolesForNewUserOnSignUp: q.data.defaultRolesForNewUserOnSignUp ?? [],
      defaultPermissionsForNewUserOnSignUp: q.data.defaultPermissionsForNewUserOnSignUp ?? [],
    });
    setRoles((q.data.defaultRolesForNewUserOnSignUp ?? []).join(', '));
    setPerms((q.data.defaultPermissionsForNewUserOnSignUp ?? []).join(', '));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      iamSettings.saveSignup({ ...s!, defaultRolesForNewUserOnSignUp: splitList(roles), defaultPermissionsForNewUserOnSignUp: splitList(perms) }),
    onSuccess: () => q.refetch(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Self-service sign-up</CardTitle>
        <CardDescription>GET /iam/v4/iam/signup-settings/admin · POST /iam/v4/iam/signup-settings (mutate-tenant-configs)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : s ? (
          <>
            <Checkbox label="Email + password sign-up" checked={s.isEmailPasswordSignUpEnabled} onChange={(v) => setS({ ...s, isEmailPasswordSignUpEnabled: v })} />
            <Checkbox label="SSO sign-up (social / hosted)" checked={s.isSSoSignUpEnabled} onChange={(v) => setS({ ...s, isSSoSignUpEnabled: v })} />
            <Field label="Default roles for new users" hint="Role slugs, comma separated.">
              <Input value={roles} onChange={(e) => setRoles(e.target.value)} />
            </Field>
            <Field label="Default permissions for new users">
              <Input value={perms} onChange={(e) => setPerms(e.target.value)} />
            </Field>
            <div className="flex items-center gap-3">
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Saved ok={save.isSuccess} />
            </div>
            {save.isError && <ErrorNote error={save.error} />}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OrgConfigTab() {
  const q = useQuery({ queryKey: ['iam', 'settings', 'org-config'], queryFn: iamSettings.orgConfigAdmin, retry: false });
  const [cfg, setCfg] = useState<OrgConfigAdmin>({});
  useEffect(() => {
    if (q.data) setCfg(pick<OrgConfigAdmin>(q.data, ORG_CONFIG_KEYS));
  }, [q.data]);
  const save = useMutation({ mutationFn: () => iamSettings.saveOrgConfig(cfg), onSuccess: () => q.refetch() });
  const flags: [keyof OrgConfigAdmin, string, string?][] = [
    ['isMultiOrgEnabled', 'Multi-organization mode', 'Cannot be turned off once on.'],
    ['consentForMultiOrgEnable', 'Consent for multi-org'],
    ['allowOrgCreationFromCloud', 'Allow creation from OS (Cloud)'],
    ['allowOrgCreationFromSignup', 'Allow creation during construct sign-up'],
    ['allowOrgCreationFromConstruct', 'Allow creation from construct'],
    ['allowOrgCreationFromPortal', 'Allow creation from construct portal', 'This is the gate createdFrom: 3 checks.'],
    ['isOrgNameUniquenessEnabled', 'Enforce unique organization names'],
    ['isSignupAutoJoinEnabled', 'Auto-join new sign-ups to an organization'],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization configuration</CardTitle>
        <CardDescription>GET /iam/v4/iam/organizations/config/admin · POST /iam/v4/iam/organizations/config</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : (
          <>
            {flags.map(([k, label, hint]) => (
              <Checkbox key={k} label={label} hint={hint} checked={!!cfg[k]} onChange={(v) => setCfg({ ...cfg, [k]: v })} />
            ))}
            <Field label="Auto-join organization id">
              <Input
                value={cfg.signupAutoJoinOrganizationId ?? ''}
                onChange={(e) => setCfg({ ...cfg, signupAutoJoinOrganizationId: e.target.value || null })}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Saved ok={save.isSuccess} />
            </div>
            {save.isError && <ErrorNote error={save.error} />}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Raw response</summary>
              <JsonView value={q.data} />
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const MFA_METHODS: [number, string][] = [
  [1, 'Authenticator app (TOTP)'],
  [2, 'Email'],
  [3, 'SMS'],
  [4, 'WhatsApp'],
];

function MfaPolicyTab() {
  const q = useQuery({ queryKey: ['iam', 'settings', 'mfa'], queryFn: iamSettings.mfaPolicy, retry: false });
  const [p, setP] = useState<MfaPolicyInput | null>(null);
  const [required, setRequired] = useState('');
  const [exempt, setExempt] = useState('');
  useEffect(() => {
    if (!q.data) return;
    const d = q.data as Record<string, unknown>;
    setP({
      enableMfa: !!(d.enableMfa ?? d.enabled),
      userMfaType: (d.userMfaType ?? d.allowedMethods ?? []) as number[],
      requireMfaForAllUsers: !!d.requireMfaForAllUsers,
      mfaRequiredRoles: (d.mfaRequiredRoles ?? []) as string[],
      mfaExemptRoles: (d.mfaExemptRoles ?? []) as string[],
      allowUserOptOut: !!d.allowUserOptOut,
      allowBackupCodes: !!d.allowBackupCodes,
      backupCodesCount: Number(d.backupCodesCount ?? 0),
      ...(d.mfaTemplate ? { mfaTemplate: d.mfaTemplate as MfaPolicyInput['mfaTemplate'] } : {}),
    });
    setRequired(((d.mfaRequiredRoles ?? []) as string[]).join(', '));
    setExempt(((d.mfaExemptRoles ?? []) as string[]).join(', '));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => iamSettings.saveMfaPolicy({ ...p!, mfaRequiredRoles: splitList(required), mfaExemptRoles: splitList(exempt) }),
    onSuccess: () => q.refetch(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MFA policy</CardTitle>
        <CardDescription>GET/POST /iam/v4/mfa/config (mfa-configs / mutate-mfa-configs)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : p ? (
          <>
            <Checkbox label="MFA enabled for the project" checked={p.enableMfa} onChange={(v) => setP({ ...p, enableMfa: v })} />
            <div>
              <p className="mb-1 text-sm font-medium">Allowed methods</p>
              <div className="flex flex-wrap gap-4">
                {MFA_METHODS.map(([n, label]) => (
                  <Checkbox
                    key={n}
                    label={label}
                    checked={p.userMfaType.includes(n)}
                    onChange={(v) => setP({ ...p, userMfaType: v ? [...p.userMfaType, n] : p.userMfaType.filter((x) => x !== n) })}
                  />
                ))}
              </div>
            </div>
            <Checkbox label="Require MFA for all users" checked={p.requireMfaForAllUsers} onChange={(v) => setP({ ...p, requireMfaForAllUsers: v })} />
            <Checkbox label="Allow users to opt out" checked={p.allowUserOptOut} onChange={(v) => setP({ ...p, allowUserOptOut: v })} />
            <Checkbox
              label="Allow backup codes"
              hint="Policy only — this IAM build has no backup-code endpoints yet."
              checked={p.allowBackupCodes}
              onChange={(v) => setP({ ...p, allowBackupCodes: v })}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Backup codes count">
                <Input type="number" value={p.backupCodesCount} onChange={(e) => setP({ ...p, backupCodesCount: Number(e.target.value) })} />
              </Field>
              <Field label="Roles that must use MFA">
                <Input value={required} onChange={(e) => setRequired(e.target.value)} />
              </Field>
              <Field label="Roles exempt from MFA">
                <Input value={exempt} onChange={(e) => setExempt(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Saved ok={save.isSuccess} />
            </div>
            {save.isError && <ErrorNote error={save.error} />}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CredentialsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['iam', 'settings', 'client-credentials'], queryFn: iamSettings.clientCredentials, retry: false });
  const [editing, setEditing] = useState<ClientCredential | 'new' | null>(null);
  const [secret, setSecret] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['iam', 'settings', 'client-credentials'] });
  const rotate = useMutation({ mutationFn: iamSettings.rotateClientSecret, onSuccess: (r) => setSecret(r) });
  const del = useMutation({ mutationFn: iamSettings.deleteClientCredential, onSuccess: refresh });
  const rows = firstArray<ClientCredential>(q.data);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Client credentials
          </CardTitle>
          <CardDescription>Machine identities for service-to-service calls, scoped to an organization.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> New
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {[rotate, del].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
        {secret !== null && (
          <div className="space-y-1 rounded-md border border-amber-500/40 p-3">
            <p className="text-sm font-medium text-amber-600">New secret — shown once. Copy it now.</p>
            <JsonView value={secret} maxHeight="max-h-40" />
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : !rows.length ? (
          <EmptyState title="No client credentials" />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((c) => (
              <li key={c.itemId} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.name} <Badge tone={c.isActive ? 'success' : 'muted'}>{c.isActive ? 'active' : 'inactive'}</Badge>
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{c.clientId ?? c.itemId}</p>
                  <p className="text-xs text-muted-foreground">
                    roles: {(c.roles ?? []).join(', ') || '—'} · token {c.accessTokenValidForNumberMinutes ?? '?'} min · {formatDate(c.createdDate)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Rotate secret" disabled={rotate.isPending} onClick={() => rotate.mutate(c.itemId)}>
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete" disabled={del.isPending} onClick={() => del.mutate(c.itemId)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && (
        <CredentialModal
          credential={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setEditing(null);
            if (r && Object.keys(r).some((k) => /secret/i.test(k))) setSecret(r);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

function CredentialModal({
  credential,
  onClose,
  onSaved,
}: {
  credential: ClientCredential | null;
  onClose: () => void;
  onSaved: (r: Record<string, unknown>) => void;
}) {
  const { activeOrgId } = useActiveOrg();
  const [name, setName] = useState(credential?.name ?? '');
  const [active, setActive] = useState(credential?.isActive ?? true);
  const [minutes, setMinutes] = useState(String(credential?.accessTokenValidForNumberMinutes ?? 60));
  const [roles, setRoles] = useState((credential?.roles ?? []).join(', '));
  const [perms, setPerms] = useState((credential?.permissions ?? []).join(', '));
  const save = useMutation({
    mutationFn: () =>
      iamSettings.saveClientCredential({
        ...(credential ? { itemId: credential.itemId } : {}),
        name: name.trim(),
        isActive: active,
        accessTokenValidForNumberMinutes: Number(minutes),
        roles: splitList(roles),
        permissions: splitList(perms),
        organizationId: credential?.organizationId ?? activeOrgId,
      }),
    onSuccess: onSaved,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={credential ? 'Edit client credential' : 'New client credential'}
      footer={
        <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Access token lifetime (minutes)">
        <Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
      <Field label="Roles" hint="A role is required, or every call with the token is unauthorized.">
        <Input value={roles} onChange={(e) => setRoles(e.target.value)} />
      </Field>
      <Field label="Permissions">
        <Input value={perms} onChange={(e) => setPerms(e.target.value)} />
      </Field>
      <Checkbox label="Active" checked={active} onChange={setActive} />
      {save.isError && <ErrorNote error={save.error} />}
    </Modal>
  );
}

function ProvidersTab() {
  const q = useQuery({ queryKey: ['iam', 'settings', 'idps'], queryFn: iamSettings.identityProviders, retry: false });
  const options = useQuery({ queryKey: ['iam', 'settings', 'login-options'], queryFn: iamSettings.loginOptions, retry: false });
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => iamSettings.setIdentityProviderActive(id, on), onSuccess: () => q.refetch() });
  const rows = firstArray<Record<string, unknown>>(q.data?.data ?? q.data);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity providers</CardTitle>
          <CardDescription>GET /iam/v4/auth/identity-providers · PATCH …/{'{id}'}/status</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {toggle.isError && <ErrorNote error={toggle.error} />}
          {q.isPending ? (
            <Spinner />
          ) : q.isError ? (
            <ErrorNote error={q.error} />
          ) : !rows.length ? (
            <EmptyState title="No identity providers" />
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((p) => {
                const id = String(p.itemId ?? p.id ?? '');
                const on = !!(p.isActive ?? p.active);
                return (
                  <li key={id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{String(p.name ?? p.provider ?? p.providerName ?? id)}</span>{' '}
                      <Badge tone="muted">{String(p.type ?? p.providerType ?? '')}</Badge>
                    </span>
                    <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate({ id, on: !on })}>
                      {on ? 'Deactivate' : 'Activate'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Login options (public)</CardTitle>
          <CardDescription>GET /iam/v4/auth/login-options — what the sign-in page offers.</CardDescription>
        </CardHeader>
        <CardContent>{options.isPending ? <Spinner /> : options.isError ? <ErrorNote error={options.error} /> : <JsonView value={options.data} />}</CardContent>
      </Card>
    </div>
  );
}

function ConfigTab() {
  const auth = useQuery({ queryKey: ['iam', 'settings', 'auth-config'], queryFn: iamSettings.authConfig, retry: false });
  const clients = useQuery({ queryKey: ['iam', 'settings', 'oidc-clients'], queryFn: iamSettings.oidcClients, retry: false });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authentication config</CardTitle>
          <CardDescription>GET /iam/v4/auth/config — token lifetimes, lockout, session policy.</CardDescription>
        </CardHeader>
        <CardContent>{auth.isPending ? <Spinner /> : auth.isError ? <ErrorNote error={auth.error} /> : <JsonView value={auth.data} />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">OIDC clients</CardTitle>
          <CardDescription>GET /iam/v4/oidc-clients — check this app's redirect URIs are registered.</CardDescription>
        </CardHeader>
        <CardContent>{clients.isPending ? <Spinner /> : clients.isError ? <ErrorNote error={clients.error} /> : <JsonView value={clients.data} />}</CardContent>
      </Card>
    </div>
  );
}

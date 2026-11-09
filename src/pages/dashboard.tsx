import { Link } from 'react-router-dom';
import { ArrowRight, Database, FolderUp, ShieldCheck, Users } from 'lucide-react';
import type { Me } from '@/features/users/api';
import { useMe, useUsers } from '@/features/users/hooks';
import { useMyOrgs } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, Spinner } from '@/components/ui/misc';
import { formatDate } from '@/lib/utils';

/** Every area of the platform this app can exercise, by the service that backs it. */
const AREAS: { service: string; items: [string, string, string][] }[] = [
  {
    service: 'IAM',
    items: [
      ['/users', 'Users', 'Invite, roles, bulk roles, activate, activity'],
      ['/roles', 'Roles', 'Role CRUD and permission assignment'],
      ['/permissions', 'Permissions', 'Permission CRUD, groups, features'],
      ['/organizations', 'Organizations', 'Create, edit, switch'],
      ['/security', 'Security', 'Password, TOTP, sessions, activity'],
      ['/iam-settings', 'IAM settings', 'Sign-up, MFA policy, client credentials'],
    ],
  },
  {
    service: 'Data',
    items: [
      ['/data', 'Data gateway', 'Schema-driven CRUD, GraphQL, validations'],
      ['/storage', 'Storage', 'Folders, uploads, versions, sharing, trash'],
    ],
  },
  {
    service: 'Services',
    items: [
      ['/localization', 'Localization', 'Languages, dictionaries, missing keys'],
      ['/notifications', 'Notifications', 'Inbox, send, live hub events'],
      ['/mail', 'Mail', 'Templated send, mailbox, templates'],
      ['/workflows', 'Workflows', 'Webhooks, executions, scheduler, functions'],
      ['/agents', 'AI agents', 'Streaming chat, history, voice session'],
      ['/utilities', 'Utilities', 'Magic links, PDF, SMS, payments'],
    ],
  },
  {
    service: 'Platform',
    items: [
      ['/build', 'Build & release', 'Injected build args, live version'],
      ['/monitor', 'Monitor', 'Heartbeat and request monitors'],
      ['/observability', 'Observability', 'Traces and logs for this project'],
      ['/secrets', 'Secrets', 'Secret store lifecycle'],
      ['/health', 'Service health', 'One probe per service'],
      ['/playground', 'API playground', 'Any request, as you'],
    ],
  },
];

function Stat({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  to?: string;
}) {
  const body = (
    <Card className="rounded-2xl border-border/70 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function SessionDetails({ me }: Readonly<{ me: Me }>) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
      <dt className="text-muted-foreground">Email</dt>
      <dd className="truncate">{me.email}</dd>
      <dt className="text-muted-foreground">User id</dt>
      <dd className="truncate font-mono text-xs">{me.itemId}</dd>
      <dt className="text-muted-foreground">Status</dt>
      <dd>
        <Badge tone={me.active ? 'success' : 'muted'}>
          {me.active ? 'Active' : 'Inactive'}
        </Badge>
      </dd>
      <dt className="text-muted-foreground">Verified</dt>
      <dd>
        <Badge tone={me.isVerified ? 'success' : 'muted'}>
          {me.isVerified ? 'Yes' : 'No'}
        </Badge>
      </dd>
      <dt className="text-muted-foreground">MFA</dt>
      <dd>
        <Badge tone={me.mfaEnabled ? 'success' : 'muted'}>
          {me.mfaEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </dd>
      <dt className="text-muted-foreground">Last login</dt>
      <dd>{formatDate(me.lastLoggedInTime)}</dd>
      <dt className="text-muted-foreground">Login count</dt>
      <dd>{me.logInCount}</dd>
    </dl>
  );
}

export function DashboardPage() {
  const { data: me } = useMe();
  const users = useUsers({}, 0, 1);
  const orgs = useMyOrgs();

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#123c50] via-[#176878] to-[#2b777a] p-7 text-white shadow-lg shadow-[#123c50]/15 sm:p-9">
        <div aria-hidden className="absolute -right-12 -top-24 h-64 w-64 rounded-full border border-white/15" />
        <div aria-hidden className="absolute -right-4 -top-16 h-64 w-64 rounded-full border border-white/15" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/65">
            Project overview
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Welcome{me?.firstName ? `, ${me.firstName}` : ''}.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
            Your people, data, and services are all here. Pick up where your team left off.
          </p>
          <Link
            to="/health"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            View service health <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Users in project"
          value={users.isPending ? '…' : String(users.data?.totalCount ?? 0)}
          icon={Users}
          to="/users"
        />
        <Stat
          label="Your organizations"
          value={orgs.isPending ? '…' : String(orgs.data?.length ?? 0)}
          icon={ShieldCheck}
        />
        <Stat label="Your roles" value={String(me?.roles?.length ?? 0)} icon={Database} to="/data" />
        <Stat label="Storage" value="DMS" icon={FolderUp} to="/storage" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {AREAS.map((area) => (
          <Card key={area.service} className="rounded-2xl border-border/70 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-[0.16em] text-primary">{area.service}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {area.items.map(([to, label, hint]) => (
                <Link key={to} to={to} className="block rounded-xl px-2 py-1.5 transition-colors hover:bg-accent">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
            <CardDescription>Straight from GET /iam/v4/iam/me</CardDescription>
          </CardHeader>
          <CardContent>{me ? <SessionDetails me={me} /> : <Spinner />}</CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Roles &amp; permissions</CardTitle>
            <CardDescription>What this session is allowed to do</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Roles
              </p>
              <div className="flex flex-wrap gap-1.5">
                {me?.roles?.length ? (
                  me.roles.map((r) => <Badge key={r}>{r}</Badge>)
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Permissions
              </p>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {me?.permissions?.length ? (
                  me.permissions.map((p) => (
                    <Badge key={p} tone="muted" className="font-mono">
                      {p}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

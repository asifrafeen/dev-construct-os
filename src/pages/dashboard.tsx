import { Link } from 'react-router-dom';
import { Database, FolderUp, ShieldCheck, Users } from 'lucide-react';
import { useMe, useUsers } from '@/features/users/hooks';
import { useMyOrgs } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, Spinner } from '@/components/ui/misc';
import { formatDate } from '@/lib/utils';

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
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
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

export function DashboardPage() {
  const { data: me } = useMe();
  const users = useUsers({}, 0, 1);
  const orgs = useMyOrgs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{me?.firstName ? `, ${me.firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in via Blocks SSO — the session lives in an HttpOnly cookie, not in JavaScript.
        </p>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
            <CardDescription>Straight from GET /iam/v4/iam/me</CardDescription>
          </CardHeader>
          <CardContent>
            {!me ? (
              <Spinner />
            ) : (
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
            )}
          </CardContent>
        </Card>

        <Card>
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

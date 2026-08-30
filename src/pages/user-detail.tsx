import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { users as usersApi, type BlocksUser } from '@/features/users/api';
import { useUserTimeline } from '@/features/users/hooks';
import { AssignRolesModal } from '@/features/users/assign-roles-modal';
import { useMyOrgsWithActive } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { displayName, formatDate, initials } from '@/lib/utils';

/**
 * `GET /iam/users/{id}` is typed as `data: object` in the Swagger — the server does not
 * publish the detail shape. So the known fields are rendered explicitly and everything
 * else is kept visible in a raw view rather than silently dropped.
 */
export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { activeOrgId } = useMyOrgsWithActive();
  const [assigning, setAssigning] = useState(false);

  const query = useQuery({
    queryKey: ['iam', 'users', 'one', userId, activeOrgId],
    queryFn: () => usersApi.get(userId as string, activeOrgId ?? undefined),
    enabled: !!userId,
    select: (r) => (r.data ?? null) as BlocksUser | null,
  });

  const timeline = useUserTimeline(userId);
  const user = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/users" aria-label="Back to users">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {user ? displayName(user) : 'User'}
            </h1>
            <p className="text-sm text-muted-foreground">
              GET /iam/v4/iam/users/{userId}
            </p>
          </div>
        </div>
        {user && (
          <Button onClick={() => setAssigning(true)}>
            <ShieldCheck className="h-4 w-4" />
            Manage roles
          </Button>
        )}
      </div>

      {query.isPending ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorNote error={query.error} />
      ) : !user ? (
        <EmptyState title="User not found" description="No user matches this id." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>Identity and account state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {initials(user.firstName, user.lastName, user.email?.[0]?.toUpperCase())}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{displayName(user)}</p>
                  <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>

              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Status">
                  <Badge tone={user.active ? 'success' : 'muted'}>
                    {user.active ? 'Active' : 'Inactive'}
                  </Badge>
                </Detail>
                <Detail label="Verified">
                  <Badge tone={user.isVerified ? 'success' : 'muted'}>
                    {user.isVerified ? 'Verified' : 'Unverified'}
                  </Badge>
                </Detail>
                <Detail label="User id">
                  <code className="break-all text-xs">{user.itemId}</code>
                </Detail>
                <Detail label="Last login">{formatDate(user.lastLoggedInTime)}</Detail>
                <Detail label="Created">{formatDate(user.createdDate)}</Detail>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Roles</CardTitle>
              <CardDescription>Granted in the active organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {user.roles?.length ? (
                <div className="flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <Badge key={r} tone="default">
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No roles assigned.</p>
              )}
              <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
                <ShieldCheck className="h-4 w-4" />
                {user.roles?.length ? 'Change roles' : 'Add a role'}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription>POST /iam/v4/iam/users/timeline</CardDescription>
            </CardHeader>
            <CardContent>
              {timeline.isPending ? (
                <Spinner />
              ) : timeline.isError ? (
                <ErrorNote error={timeline.error} />
              ) : !timeline.data?.data?.length ? (
                <EmptyState title="No activity recorded" />
              ) : (
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(timeline.data.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Raw payload</CardTitle>
              <CardDescription>
                The server does not publish this response's shape, so nothing is hidden here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                {JSON.stringify(user, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {assigning && user && (
        <AssignRolesModal
          userId={user.itemId}
          displayName={displayName(user)}
          currentRoles={user.roles ?? []}
          onClose={() => setAssigning(false)}
        />
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

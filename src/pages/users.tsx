import { useState } from 'react';
import { useUsers } from '@/features/users/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { formatDate, initials } from '@/lib/utils';

const PAGE_SIZE = 20;

export function UsersPage() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const { data, isPending, isError, error } = useUsers({}, page, PAGE_SIZE);

  const rows = (data?.data ?? []).filter((u) => {
    if (!search.trim()) return true;
    const haystack = [u.firstName, u.lastName, u.email].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const total = data?.totalCount ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            POST /iam/v4/iam/users — scoped to your project by the session.
          </p>
        </div>
        <Input
          className="w-full max-w-xs"
          placeholder="Filter this page…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Project members</CardTitle>
            <CardDescription>{total} total</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {isPending ? (
            <Spinner />
          ) : isError ? (
            <ErrorNote error={error} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No users to show"
              description={search ? 'Nothing on this page matches your filter.' : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">User</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Roles</th>
                    <th className="px-2 py-2 font-medium">Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.itemId} className="border-b last:border-0">
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                            {initials(u.firstName, u.lastName, u.email?.[0]?.toUpperCase())}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <Badge tone={u.active ? 'success' : 'muted'}>
                          {u.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles?.length ? (
                            u.roles.map((r) => (
                              <Badge key={r} tone="muted">
                                {r}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {formatDate(u.lastLoggedInTime)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} of {lastPage + 1}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

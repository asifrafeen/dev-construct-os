import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { BlocksUser } from '@/features/users/api';
import { useAssignUserAccess, useUsers } from '@/features/users/hooks';
import { useAssignableRoles, useRoles } from '@/features/roles/hooks';
import { useMyOrgsWithActive } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatDate, initials } from '@/lib/utils';

const PAGE_SIZE = 20;

export function UsersPage() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<BlocksUser | null>(null);
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
                    <th className="px-2 py-2 text-right font-medium">Actions</th>
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
                      <td className="px-2 py-3">
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" onClick={() => setAssigning(u)}>
                            <ShieldCheck className="h-4 w-4" />
                            Roles
                          </Button>
                        </div>
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
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
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

      {assigning && <AssignRolesModal user={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

/**
 * Grants roles in the organization the header is currently on.
 *
 * The endpoint *replaces* the user's access rather than appending to it, so the
 * checkbox set is submitted whole — unchecking is how a role is taken away.
 */
function AssignRolesModal({ user, onClose }: { user: BlocksUser; onClose: () => void }) {
  const { orgs, activeOrgId } = useMyOrgsWithActive();
  const activeOrg = orgs.find((o) => o.itemId === activeOrgId);

  const rolesQuery = useRoles({ pageSize: 200 });
  const { assignableSlugs, isError: assignableFailed } = useAssignableRoles();
  const assign = useAssignUserAccess();

  const [selected, setSelected] = useState<Set<string>>(() => new Set(user.roles ?? []));
  const [filter, setFilter] = useState('');

  // A row rendered from a stale list can open with roles that have since changed.
  useEffect(() => setSelected(new Set(user.roles ?? [])), [user]);

  const available = (rolesQuery.data?.data ?? []).filter((r) => !r.isArchived);
  const options = available.filter((r) => {
    if (!filter.trim()) return true;
    const hay = [r.name, r.slug, r.description].filter(Boolean).join(' ');
    return hay.toLowerCase().includes(filter.trim().toLowerCase());
  });

  /**
   * `roles/assignable` is the admin's own grant ceiling. Gate on it only when it
   * actually returned something — an empty or failed response must not lock the
   * whole form, since the server enforces the rule regardless.
   */
  const gateOnAssignable = !assignableFailed && assignableSlugs.size > 0;
  const canGrant = (slug?: string) => !gateOnAssignable || (!!slug && assignableSlugs.has(slug));

  const original = new Set(user.roles ?? []);
  const dirty =
    selected.size !== original.size || [...selected].some((s) => !original.has(s));

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'user';

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title={`Roles — ${name}`}
      description={
        <>
          Granted in{' '}
          <span className="font-medium text-foreground">
            {activeOrg?.name ?? 'the active organization'}
          </span>
          . Unchecking a role removes it.
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!dirty || assign.isPending}
            onClick={() =>
              assign.mutate(
                { userId: user.itemId, roles: [...selected] },
                { onSuccess: () => onClose() },
              )
            }
          >
            {assign.isPending ? 'Saving…' : dirty ? `Save ${selected.size} role(s)` : 'No changes'}
          </Button>
        </>
      }
    >
      <Input
        placeholder="Filter roles…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {rolesQuery.isPending ? (
        <Spinner label="Loading roles…" />
      ) : rolesQuery.isError ? (
        <ErrorNote error={rolesQuery.error} />
      ) : options.length === 0 ? (
        <EmptyState
          title="No roles available"
          description={
            filter
              ? 'Nothing matches your filter.'
              : 'This organization has no roles yet — create one on the Roles page first.'
          }
        />
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2">
          {options.map((r) => {
            const slug = r.slug ?? '';
            const grantable = canGrant(r.slug);
            return (
              <label
                key={r.itemId}
                className={
                  grantable
                    ? 'flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-accent'
                    : 'flex items-start gap-2 rounded-md p-2 text-sm opacity-60'
                }
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  disabled={!grantable || !slug}
                  checked={selected.has(slug)}
                  onChange={() => slug && toggle(slug)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{slug}</code>
                  {!grantable && (
                    <Badge tone="muted" className="ml-2">
                      Not yours to grant
                    </Badge>
                  )}
                  {r.description && (
                    <span className="block text-xs text-muted-foreground">{r.description}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* Roles held but no longer present in this org's list — surfaced so a save doesn't drop them silently. */}
      {(user.roles ?? []).some((r) => !available.some((a) => a.slug === r)) && (
        <p className="text-xs text-muted-foreground">
          Also holds:{' '}
          {(user.roles ?? [])
            .filter((r) => !available.some((a) => a.slug === r))
            .join(', ')}{' '}
          — held outside this organization. They are kept as-is when you save.
        </p>
      )}

      {assign.isError && <ErrorNote error={assign.error} />}
    </Modal>
  );
}

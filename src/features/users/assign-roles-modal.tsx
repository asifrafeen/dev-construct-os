import { useEffect, useState } from 'react';
import { useAssignUserAccess } from '@/features/users/hooks';
import { useAssignableRoles, useRoles } from '@/features/roles/hooks';
import { useMyOrgsWithActive } from '@/features/orgs/hooks';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * Grants roles in the organization the header is currently on.
 *
 * The endpoint *replaces* the user's access rather than appending to it, so the
 * checkbox set is submitted whole — unchecking is how a role is taken away.
 *
 * Shared by the user list and the user detail page, which is why it takes a plain
 * id/name/roles triple rather than a `BlocksUser`: the detail page's payload is typed
 * as `object` by the API and can't be relied on to be one.
 */
export function AssignRolesModal({
  userId,
  displayName,
  currentRoles,
  onClose,
}: {
  userId: string;
  displayName: string;
  currentRoles: string[];
  onClose: () => void;
}) {
  const { orgs, activeOrgId } = useMyOrgsWithActive();
  const activeOrg = orgs.find((o) => o.itemId === activeOrgId);

  const rolesQuery = useRoles({ pageSize: 200 });
  const { assignableSlugs, isError: assignableFailed } = useAssignableRoles();
  const assign = useAssignUserAccess();

  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentRoles));
  const [filter, setFilter] = useState('');

  // A row rendered from a stale list can open with roles that have since changed.
  const rolesKey = currentRoles.join(',');
  useEffect(() => setSelected(new Set(rolesKey ? rolesKey.split(',') : [])), [userId, rolesKey]);

  const available = (rolesQuery.data?.data ?? []).filter((r) => !r.isArchived);
  const options = available.filter((r) => {
    if (!filter.trim()) return true;
    const hay = [r.name, r.slug, r.description].filter(Boolean).join(' ');
    return hay.toLowerCase().includes(filter.trim().toLowerCase());
  });

  /**
   * `roles/assignable` is the admin's own grant ceiling. Gate on it only when it
   * actually returned something — an empty or failed response must not lock the whole
   * form, since the server enforces the rule regardless.
   */
  const gateOnAssignable = !assignableFailed && assignableSlugs.size > 0;
  const canGrant = (slug?: string) => !gateOnAssignable || (!!slug && assignableSlugs.has(slug));

  const original = new Set(currentRoles);
  const dirty = selected.size !== original.size || [...selected].some((s) => !original.has(s));

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const outsideOrg = currentRoles.filter((r) => !available.some((a) => a.slug === r));

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title={`Roles — ${displayName}`}
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
              assign.mutate({ userId, roles: [...selected] }, { onSuccess: () => onClose() })
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

      {/* Roles held but absent from this org's list — shown so a save doesn't look lossy. */}
      {outsideOrg.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also holds: {outsideOrg.join(', ')} — held outside this organization. They are kept as-is
          when you save.
        </p>
      )}

      {assign.isError && <ErrorNote error={assign.error} />}
    </Modal>
  );
}

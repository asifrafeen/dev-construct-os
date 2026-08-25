import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { roles as rolesApi, slugify, type Role } from '@/features/roles/api';
import {
  useCreateRole,
  useDeleteRole,
  useRolePermissions,
  useRoles,
  useSetRolePermissions,
  useUpdateRole,
} from '@/features/roles/hooks';
import { useMyOrgsWithActive } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Field, Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

const PAGE_SIZE = 20;

export function RolesPage() {
  const { orgs, activeOrgId } = useMyOrgsWithActive();
  const activeOrg = orgs.find((o) => o.itemId === activeOrgId);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<Role | null>(null);

  // A narrowed search or an org switch would otherwise leave you on an empty page 5.
  useEffect(() => setPage(0), [search, activeOrgId]);

  const { data, isPending, isError, error } = useRoles({ search, page, pageSize: PAGE_SIZE });
  const rows = data?.data ?? [];
  const total = data?.totalCount ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">
            POST /iam/v4/iam/roles — scoped to{' '}
            <span className="font-medium text-foreground">
              {activeOrg?.name ?? 'your organization'}
            </span>
            . Switch organizations in the header to manage another set.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-full max-w-xs"
            placeholder="Search roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            New role
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Organization roles</CardTitle>
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
              title="No roles yet"
              description={
                search
                  ? 'No role in this organization matches your search.'
                  : 'Create a role to start granting access in this organization.'
              }
              action={
                search ? undefined : (
                  <Button size="sm" className="mt-2" onClick={() => setEditing('new')}>
                    <Plus className="h-4 w-4" />
                    New role
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Role</th>
                    <th className="px-2 py-2 font-medium">Slug</th>
                    <th className="px-2 py-2 font-medium">Parent</th>
                    <th className="px-2 py-2 font-medium">Users</th>
                    <th className="px-2 py-2 font-medium">Created</th>
                    <th className="px-2 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.itemId} className="border-b last:border-0">
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.name || '—'}</span>
                          {r.isArchived && <Badge tone="danger">Archived</Badge>}
                        </div>
                        {r.description && (
                          <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.slug}</code>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">{r.parentRoleSlug || '—'}</td>
                      <td className="px-2 py-3 text-muted-foreground">{r.count ?? 0}</td>
                      <td className="px-2 py-3 text-muted-foreground">{formatDate(r.createdDate)}</td>
                      <td className="px-2 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Permissions"
                            onClick={() => setPermissionsFor(r)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-4 w-4" />
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

      {editing && (
        <RoleFormModal
          role={editing === 'new' ? null : editing}
          existing={rows}
          orgName={activeOrg?.name}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && <DeleteRoleModal role={deleting} onClose={() => setDeleting(null)} />}
      {permissionsFor && (
        <RolePermissionsModal role={permissionsFor} onClose={() => setPermissionsFor(null)} />
      )}
    </div>
  );
}

/** Create and edit share one form; only the slug field and the endpoint differ. */
function RoleFormModal({
  role,
  existing,
  orgName,
  onClose,
}: {
  role: Role | null;
  existing: Role[];
  orgName?: string;
  onClose: () => void;
}) {
  const isEdit = !!role;
  const create = useCreateRole();
  const update = useUpdateRole();
  const mutation = isEdit ? update : create;

  const [name, setName] = useState(role?.name ?? '');
  const [slug, setSlug] = useState(role?.slug ?? '');
  // Once the slug is hand-edited, stop deriving it from the name.
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(role?.description ?? '');
  const [parentRoleSlug, setParentRoleSlug] = useState(role?.parentRoleSlug ?? '');
  const [canCreateOwn, setCanCreateOwn] = useState(role?.canCreateOwn ?? false);
  const [propagate, setPropagate] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  // A role can't be its own parent.
  const parentOptions = existing.filter((r) => r.slug && r.slug !== role?.slug);
  const duplicate = !isEdit && !!effectiveSlug && existing.some((r) => r.slug === effectiveSlug);
  const canSubmit = name.trim().length > 0 && !!effectiveSlug && !duplicate && !mutation.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const common = {
      name: name.trim(),
      description: description.trim() || undefined,
      parentRoleSlug: parentRoleSlug || undefined,
      canCreateOwn,
    };
    const done = { onSuccess: () => onClose() };
    if (isEdit) {
      update.mutate({ itemId: role.itemId, propagateToOtherOrg: propagate, ...common }, done);
    } else {
      create.mutate({ slug: effectiveSlug, ...common }, done);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${role.name}` : 'New role'}
      description={
        isEdit
          ? 'The slug is the role’s identity and cannot change.'
          : `Created in ${orgName ?? 'the active organization'}.`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" htmlFor="role-name">
          <Input
            id="role-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Site Manager"
          />
        </Field>

        <Field
          label="Slug"
          htmlFor="role-slug"
          hint={
            isEdit
              ? 'Fixed for the life of the role — every assignment references it.'
              : 'Lowercase identifier used wherever the role is assigned.'
          }
        >
          <Input
            id="role-slug"
            value={effectiveSlug}
            disabled={isEdit}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            placeholder="site-manager"
          />
        </Field>
        {duplicate && (
          <p className="text-sm text-destructive">
            A role with the slug <code>{effectiveSlug}</code> already exists in this organization.
          </p>
        )}

        <Field label="Description" htmlFor="role-description">
          <textarea
            id="role-description"
            className="h-20 w-full resize-y rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this role is for."
          />
        </Field>

        <Field
          label="Parent role"
          htmlFor="role-parent"
          hint="Inherits the parent’s permissions. Leave empty for a standalone role."
        >
          <select
            id="role-parent"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={parentRoleSlug}
            onChange={(e) => setParentRoleSlug(e.target.value)}
          >
            <option value="">— none —</option>
            {parentOptions.map((r) => (
              <option key={r.itemId} value={r.slug}>
                {r.name} ({r.slug})
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={canCreateOwn}
            onChange={(e) => setCanCreateOwn(e.target.checked)}
          />
          <span>
            Holders can create sub-roles
            <span className="block text-xs text-muted-foreground">
              Lets someone with this role define roles beneath it.
            </span>
          </span>
        </label>

        {isEdit && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={propagate}
              onChange={(e) => setPropagate(e.target.checked)}
            />
            <span>
              Apply to every organization
              <span className="block text-xs text-muted-foreground">
                Updates this role wherever it exists, not only in the active organization.
              </span>
            </span>
          </label>
        )}

        {mutation.isError && <ErrorNote error={mutation.error} />}
        {/* Lets Enter submit the form without a second visible button. */}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

/**
 * Deleting a role that people hold revokes their access, so the server refuses unless
 * `confirmRevokeFromUsers` is set. The impact preview turns that into an informed
 * choice rather than a blind retry.
 */
function DeleteRoleModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const remove = useDeleteRole();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const impact = useQuery({
    queryKey: ['iam', 'roles', 'archive-impact', role.itemId],
    queryFn: () => rolesApi.archiveImpact(role.itemId),
    retry: false,
  });

  const holders = role.count ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${role.name}?`}
      description="This removes the role from the organization."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || (holders > 0 && !confirmRevoke)}
            onClick={() =>
              remove.mutate(
                { id: role.itemId, confirmRevokeFromUsers: confirmRevoke },
                { onSuccess: () => onClose() },
              )
            }
          >
            {remove.isPending ? 'Deleting…' : 'Delete role'}
          </Button>
        </>
      }
    >
      {holders > 0 && (
        <>
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <strong>{holders}</strong> {holders === 1 ? 'user holds' : 'users hold'} this role and
            will lose the access it grants.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={confirmRevoke}
              onChange={(e) => setConfirmRevoke(e.target.checked)}
            />
            <span>Yes, revoke this role from those users.</span>
          </label>
        </>
      )}

      {impact.isPending ? (
        <Spinner label="Checking impact…" />
      ) : impact.data ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Impact details</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
            {JSON.stringify(impact.data, null, 2)}
          </pre>
        </details>
      ) : null}

      {remove.isError && <ErrorNote error={remove.error} />}
    </Modal>
  );
}

/** The grant API takes add/remove lists, so the checkboxes are diffed against what's already granted. */
function RolePermissionsModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const { activeOrgId } = useMyOrgsWithActive();
  const granted = useRolePermissions(role.slug);
  const all = useQuery({
    queryKey: ['iam', 'permissions', activeOrgId],
    queryFn: () => rolesApi.permissions({ organizationId: activeOrgId }),
  });
  const save = useSetRolePermissions();

  const grantedNames = useMemo(
    () => new Set((granted.data?.data ?? []).map((p) => p.name).filter((n): n is string => !!n)),
    [granted.data],
  );

  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Seed the checkboxes once the current grants land, then let the user drive.
  useEffect(() => {
    if (granted.data && selected === null) setSelected(new Set(grantedNames));
  }, [granted.data, grantedNames, selected]);

  const [filter, setFilter] = useState('');
  const options = (all.data?.data ?? []).filter((p) => {
    if (!filter.trim()) return true;
    const hay = [p.name, p.description, p.resource, p.resourceGroup].filter(Boolean).join(' ');
    return hay.toLowerCase().includes(filter.trim().toLowerCase());
  });

  const current = selected ?? grantedNames;
  const addPermissions = [...current].filter((n) => !grantedNames.has(n));
  const removePermissions = [...grantedNames].filter((n) => !current.has(n));
  const dirty = addPermissions.length > 0 || removePermissions.length > 0;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? grantedNames);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-2xl"
      title={`Permissions — ${role.name}`}
      description={
        <>
          Granted to <code>{role.slug}</code> in this organization.
          {role.parentRoleSlug &&
            ` Permissions inherited from ${role.parentRoleSlug} are not listed here.`}
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!dirty || save.isPending || !role.slug}
            onClick={() =>
              save.mutate(
                { slug: role.slug as string, addPermissions, removePermissions },
                { onSuccess: () => onClose() },
              )
            }
          >
            {save.isPending
              ? 'Saving…'
              : dirty
                ? `Save (+${addPermissions.length} / −${removePermissions.length})`
                : 'No changes'}
          </Button>
        </>
      }
    >
      <Input
        placeholder="Filter permissions…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {granted.isPending || all.isPending ? (
        <Spinner label="Loading permissions…" />
      ) : all.isError ? (
        <ErrorNote error={all.error} />
      ) : options.length === 0 ? (
        <EmptyState
          title="No permissions"
          description={
            filter ? 'Nothing matches your filter.' : 'This project has no permissions defined yet.'
          }
        />
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2">
          {options.map((p) => (
            <label
              key={p.itemId}
              className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={!!p.name && current.has(p.name)}
                onChange={() => p.name && toggle(p.name)}
              />
              <span className="min-w-0">
                <span className="font-medium">{p.name}</span>
                {p.resourceGroup && (
                  <Badge tone="muted" className="ml-2">
                    {p.resourceGroup}
                  </Badge>
                )}
                {p.description && (
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {save.isError && <ErrorNote error={save.error} />}
    </Modal>
  );
}

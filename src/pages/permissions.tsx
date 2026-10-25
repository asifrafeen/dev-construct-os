import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Trash2 } from 'lucide-react';
import { permissions, type PermissionInput } from '@/features/permissions/api';
import type { Permission } from '@/features/roles/api';
import { useActiveOrg } from '@/features/orgs/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, splitList } from '@/components/ui/form';
import { JsonView, PageHeader, Pager, Tabs } from '@/components/ui/layout';

const PAGE_SIZE = 20;
type Tab = 'list' | 'catalog';

export function PermissionsPage() {
  const [tab, setTab] = useState<Tab>('list');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Permissions"
        description="Define the capabilities roles grant. Writes need blocks-iam::iam::mutate-permissions."
        endpoints={[
          'POST /iam/v4/iam/permissions',
          'POST /iam/v4/iam/permissions/create',
          'POST /iam/v4/iam/permissions/{id}',
          'DELETE /iam/v4/iam/permissions/{id}',
          'GET /iam/v4/iam/resource-groups',
          'GET /iam/v4/iam/resource/features',
        ]}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'list', label: 'Permissions' },
          { value: 'catalog', label: 'Groups, severity & features' },
        ]}
      />
      {tab === 'list' ? <PermissionList /> : <Catalog />}
    </div>
  );
}

function PermissionList() {
  const { activeOrgId } = useActiveOrg();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [archived, setArchived] = useState(false);
  const [builtIn, setBuiltIn] = useState<'' | 'yes' | 'no'>('');
  const [editing, setEditing] = useState<Permission | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Permission | null>(null);

  const groups = useQuery({ queryKey: ['iam', 'resource-groups'], queryFn: permissions.resourceGroups, retry: false });
  const list = useQuery({
    queryKey: ['iam', 'permissions', activeOrgId, page, search, group, archived, builtIn],
    queryFn: () =>
      permissions.list({
        page,
        pageSize: PAGE_SIZE,
        organizationId: activeOrgId,
        filter: {
          search: search.trim(),
          isArchived: archived,
          ...(group ? { resourceGroup: group } : {}),
          ...(builtIn ? { isBuiltIn: builtIn } : {}),
        },
      }),
  });
  const rows = list.data?.data ?? [];
  const total = list.data?.totalCount ?? 0;
  const groupNames = (groups.data ?? []).map((g) => (typeof g === 'string' ? g : String((g as Record<string, unknown>).name ?? (g as Record<string, unknown>).resourceGroup ?? JSON.stringify(g))));

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{total} permissions</CardTitle>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New permission
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <Select className="w-48" value={group} onChange={(e) => { setGroup(e.target.value); setPage(0); }}>
            <option value="">All resource groups</option>
            {groupNames.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
          <Select className="w-36" value={builtIn} onChange={(e) => setBuiltIn(e.target.value as '' | 'yes' | 'no')}>
            <option value="">Built-in: any</option>
            <option value="yes">Built-in only</option>
            <option value="no">Custom only</option>
          </Select>
          <Checkbox label="Archived" checked={archived} onChange={setArchived} />
        </div>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !rows.length ? (
          <EmptyState title="No permissions match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Resource</th>
                  <th className="px-2 py-2 font-medium">Group</th>
                  <th className="px-2 py-2 font-medium">Roles</th>
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.itemId} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      <div className="mt-0.5 flex gap-1">
                        {p.isBuiltIn && <Badge tone="muted">built-in</Badge>}
                        {p.isArchived && <Badge tone="danger">archived</Badge>}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{p.resource}</td>
                    <td className="px-2 py-2 text-xs">{p.resourceGroup}</td>
                    <td className="px-2 py-2">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {(p.roles ?? []).map((r) => (
                          <Badge key={r}>{r}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => setDeleting(p)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager zeroBased page={page} pageCount={Math.ceil(total / PAGE_SIZE)} total={total} onChange={setPage} />
      </CardContent>
      {editing && (
        <PermissionModal
          permission={editing === 'new' ? null : editing}
          groups={groupNames}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['iam', 'permissions'] });
          }}
        />
      )}
      {deleting && (
        <DeleteModal
          permission={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            void qc.invalidateQueries({ queryKey: ['iam', 'permissions'] });
          }}
        />
      )}
    </Card>
  );
}

function PermissionModal({
  permission,
  groups,
  onClose,
  onSaved,
}: {
  permission: Permission | null;
  groups: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const p = permission as (Permission & { tags?: string[]; dependentPermissions?: string[]; type?: number; permissionSeverity?: number }) | null;
  const [name, setName] = useState(p?.name ?? '');
  const [resource, setResource] = useState(p?.resource ?? '');
  const [resourceGroup, setGroup] = useState(p?.resourceGroup ?? groups[0] ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [tags, setTags] = useState((p?.tags ?? []).join(', '));
  const [dependents, setDependents] = useState((p?.dependentPermissions ?? []).join(', '));
  const [type, setType] = useState(String(p?.type ?? 1));
  const [severity, setSeverity] = useState(String(p?.permissionSeverity ?? ''));
  const [archivedFlag, setArchivedFlag] = useState(!!p?.isArchived);

  const save = useMutation({
    mutationFn: () => {
      const input: PermissionInput = {
        name: name.trim(),
        resource: resource.trim(),
        resourceGroup: resourceGroup.trim() || undefined,
        description: description.trim() || undefined,
        type: Number(type),
        tags: splitList(tags),
        dependentPermissions: splitList(dependents),
        ...(severity !== '' ? { permissionSeverity: Number(severity) } : {}),
      };
      return p ? permissions.update(p.itemId, { ...input, isArchived: archivedFlag }) : permissions.create(input);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={p ? 'Edit permission' : 'New permission'}
      footer={
        <Button disabled={!name.trim() || !resource.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Resource" hint="The string checked at runtime, e.g. myapp::invoices::approve.">
        <Input className="font-mono text-xs" value={resource} onChange={(e) => setResource(e.target.value)} />
      </Field>
      <Field label="Resource group">
        <Input list="resource-groups" value={resourceGroup} onChange={(e) => setGroup(e.target.value)} />
        <datalist id="resource-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      <Field label="Description">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type (ResourceType, numeric)">
          <Input type="number" value={type} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="Severity (numeric, optional)">
          <Input type="number" value={severity} onChange={(e) => setSeverity(e.target.value)} />
        </Field>
      </div>
      <Field label="Tags">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma separated" />
      </Field>
      <Field label="Dependent permissions" hint="Granted alongside this one.">
        <Input value={dependents} onChange={(e) => setDependents(e.target.value)} placeholder="comma separated resources" />
      </Field>
      {p && <Checkbox label="Archived" checked={archivedFlag} onChange={setArchivedFlag} />}
      {save.isError && <ErrorNote error={save.error} />}
    </Modal>
  );
}

function DeleteModal({ permission, onClose, onDone }: { permission: Permission; onClose: () => void; onDone: () => void }) {
  const impact = useQuery({ queryKey: ['iam', 'permissions', 'impact', permission.itemId], queryFn: () => permissions.archiveImpact(permission.itemId), retry: false });
  const [confirm, setConfirm] = useState(false);
  const del = useMutation({ mutationFn: () => permissions.remove(permission.itemId, confirm), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete “${permission.name}”?`}
      footer={
        <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
          <Archive className="h-4 w-4" /> Delete
        </Button>
      }
    >
      <p className="text-sm font-medium">Archive impact</p>
      {impact.isPending ? <Spinner /> : impact.isError ? <ErrorNote error={impact.error} /> : <JsonView value={impact.data} maxHeight="max-h-48" />}
      <Checkbox
        label="Also revoke it from users who hold it directly"
        hint="Without this the server refuses to delete a permission still in use."
        checked={confirm}
        onChange={setConfirm}
      />
      {del.isError && <ErrorNote error={del.error} />}
    </Modal>
  );
}

function Catalog() {
  const groups = useQuery({ queryKey: ['iam', 'resource-groups'], queryFn: permissions.resourceGroups, retry: false });
  const severity = useQuery({ queryKey: ['iam', 'permissions', 'by-severity'], queryFn: permissions.bySeverity, retry: false });
  const [search, setSearch] = useState('');
  const features = useQuery({ queryKey: ['iam', 'features', search], queryFn: () => permissions.features(search.trim() || undefined), retry: false });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resource groups</CardTitle>
          <CardDescription>Read-only.</CardDescription>
        </CardHeader>
        <CardContent>{groups.isPending ? <Spinner /> : groups.isError ? <ErrorNote error={groups.error} /> : <JsonView value={groups.data} />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By severity</CardTitle>
        </CardHeader>
        <CardContent>{severity.isPending ? <Spinner /> : severity.isError ? <ErrorNote error={severity.error} /> : <JsonView value={severity.data} />}</CardContent>
      </Card>
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Feature catalogue</CardTitle>
          <CardDescription>Any signed-in user can read this.</CardDescription>
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardHeader>
        <CardContent>
          {features.isPending ? (
            <Spinner />
          ) : features.isError ? (
            <ErrorNote error={features.error} />
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto text-sm">
              {(features.data ?? []).map((f, i) => (
                <li key={`${f.resource}-${i}`} className="py-1.5">
                  <p className="font-medium">{f.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{f.resource}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

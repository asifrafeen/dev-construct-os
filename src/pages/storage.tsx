import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  FolderPlus,
  History,
  Info,
  KeyRound,
  MoveRight,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  directories,
  files,
  MODULES,
  objects,
  type ObjectPage,
  type PolicyInput,
  type PrincipalType,
  type StorageObject,
  type StoragePermission,
} from '@/features/files/api';
import { useDeleteFile, useUploadFile } from '@/features/files/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, parseJsonInput } from '@/components/ui/form';
import { JsonView, PageHeader, Tabs } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';
import { trackedFetch } from '@/lib/tracked-fetch';

function prettyBytes(n?: number) {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

type Tab = 'browse' | 'search' | 'shared' | 'trash';
type Crumb = { id: string; name: string };

/** Everything in DMS hangs off one key, so any mutation can refresh every listing. */
const STORAGE_KEY = ['storage'] as const;

export function StoragePage() {
  const [tab, setTab] = useState<Tab>('browse');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        description="Blocks DMS: directories, uploads, versions, trash, sharing and access policies."
        endpoints={[
          'GET /data/v4/objects/get-objects',
          'POST /data/v4/files/get-pre-signed-url-for-upload',
          'POST /data/v4/files/complete-upload',
          'POST /data/v4/directory/create-directory',
          'GET /data/v4/objects/get-access-policies',
        ]}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'browse', label: 'Browse' },
          { value: 'search', label: 'Search' },
          { value: 'shared', label: 'Shared with me' },
          { value: 'trash', label: 'Trash' },
        ]}
      />
      {tab === 'browse' && <Browser />}
      {tab === 'search' && <SearchTab />}
      {tab === 'shared' && <FlatList title="Shared with me" queryKey="shared" fetchPage={(c) => objects.shared(c)} />}
      {tab === 'trash' && <TrashTab />}
    </div>
  );
}

function useInvalidateStorage() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STORAGE_KEY });
}

function Browser() {
  const [path, setPath] = useState<Crumb[]>([]);
  const [moduleName, setModuleName] = useState<number>(MODULES.Default_Cloud);
  const [newFolder, setNewFolder] = useState(false);
  const current = path[path.length - 1];
  const upload = useUploadFile({ parentDirectoryId: current?.id ?? '', moduleName });
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const list = useInfiniteQuery({
    queryKey: [...STORAGE_KEY, 'browse', current?.id ?? null, moduleName],
    queryFn: ({ pageParam }) =>
      objects.list({ parentDirectoryId: current?.id, moduleName: current ? undefined : moduleName, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ObjectPage) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="font-medium hover:underline" onClick={() => setPath([])}>
            Root
          </button>
          {path.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button className="font-medium hover:underline" onClick={() => setPath(path.slice(0, i + 1))}>
                {c.name}
              </button>
            </span>
          ))}
          {current && <code className="ml-2 text-[11px] text-muted-foreground">{current.id}</code>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!current && (
            <Select className="w-52" value={moduleName} onChange={(e) => setModuleName(Number(e.target.value))} title="Module (root only)">
              {Object.entries(MODULES).map(([name, n]) => (
                <option key={n} value={n}>
                  {n} · {name}
                </option>
              ))}
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => setNewFolder(true)}>
            <FolderPlus className="h-4 w-4" /> New folder
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <UploadCloud className="h-4 w-4" />
            {upload.isPending ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={upload.isPending}
              onChange={async (e) => {
                const chosen = Array.from(e.target.files ?? []);
                e.target.value = '';
                setUploadErrors([]);
                for (const f of chosen) {
                  try {
                    await upload.mutateAsync(f);
                  } catch (err) {
                    setUploadErrors((prev) => [...prev, `${f.name}: ${err instanceof Error ? err.message : String(err)}`]);
                  }
                }
              }}
            />
          </label>
          <Button variant="ghost" size="sm" onClick={() => list.refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {uploadErrors.map((e) => (
          <ErrorNote key={e} error={e} />
        ))}
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : items.length === 0 ? (
          <EmptyState title="Empty" description="Upload a file or create a folder here." />
        ) : (
          <ObjectTable items={items} onOpenDir={(o) => setPath([...path, { id: o.itemId, name: o.name }])} />
        )}
        {list.hasNextPage && (
          <Button variant="outline" size="sm" className="mt-3" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </CardContent>
      {newFolder && <NewFolderModal parentId={current?.id} moduleName={moduleName} onClose={() => setNewFolder(false)} />}
    </Card>
  );
}

type Dialog =
  | { kind: 'rename'; obj: StorageObject }
  | { kind: 'move'; obj: StorageObject; copy: boolean }
  | { kind: 'versions'; obj: StorageObject }
  | { kind: 'access'; obj: StorageObject }
  | { kind: 'details'; obj: StorageObject }
  | { kind: 'delete'; obj: StorageObject };

function ObjectTable({ items, onOpenDir }: { items: StorageObject[]; onOpenDir?: (o: StorageObject) => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const open = useMutation({
    mutationFn: (fileId: string) => files.get(fileId),
    onSuccess: (rec) => rec.url && window.open(rec.url, '_blank', 'noopener'),
  });

  return (
    <>
      {open.isError && <ErrorNote error={open.error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Size</th>
              <th className="px-2 py-2 font-medium">Modified</th>
              <th className="px-2 py-2 font-medium">Your access</th>
              <th className="px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const isDir = o.type === 'directory';
              return (
                <tr key={o.itemId} className="border-b last:border-0">
                  <td className="px-2 py-2">
                    <button
                      className="flex items-center gap-2 text-left hover:underline disabled:no-underline"
                      disabled={!isDir || !onOpenDir}
                      onClick={() => isDir && onOpenDir?.(o)}
                    >
                      {isDir ? <Folder className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                      <span className="truncate">{o.name}</span>
                      {o.isDefault && <Badge tone="muted">default</Badge>}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{isDir ? '—' : prettyBytes(o.sizeInBytes)}</td>
                  <td className="px-2 py-2 text-muted-foreground">{formatDate(o.lastUpdatedDate ?? o.createdDate)}</td>
                  <td className="px-2 py-2">
                    <PermissionBadges p={o.permissions} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-0.5">
                      {!isDir && (
                        <IconBtn title="Open / download" onClick={() => open.mutate(o.itemId)}>
                          <Download className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                      <IconBtn title="Details" onClick={() => setDialog({ kind: 'details', obj: o })}>
                        <Info className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn title="Rename" onClick={() => setDialog({ kind: 'rename', obj: o })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn title="Move" onClick={() => setDialog({ kind: 'move', obj: o, copy: false })}>
                        <MoveRight className="h-3.5 w-3.5" />
                      </IconBtn>
                      {!isDir && (
                        <>
                          <IconBtn title="Copy" onClick={() => setDialog({ kind: 'move', obj: o, copy: true })}>
                            <Copy className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn title="Versions" onClick={() => setDialog({ kind: 'versions', obj: o })}>
                            <History className="h-3.5 w-3.5" />
                          </IconBtn>
                        </>
                      )}
                      <IconBtn title="Access & sharing" onClick={() => setDialog({ kind: 'access', obj: o })}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn title="Delete" onClick={() => setDialog({ kind: 'delete', obj: o })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'rename' && <RenameModal obj={dialog.obj} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'move' && <MoveModal obj={dialog.obj} copy={dialog.copy} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'versions' && <VersionsModal obj={dialog.obj} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'access' && <AccessModal obj={dialog.obj} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'details' && <DetailsModal obj={dialog.obj} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteModal obj={dialog.obj} onClose={() => setDialog(null)} />}
    </>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" title={title} onClick={onClick}>
      {children}
    </Button>
  );
}

function PermissionBadges({ p }: { p?: StorageObject['permissions'] }) {
  if (!p) return <span className="text-xs text-muted-foreground">—</span>;
  const flags = (['canView', 'canDownload', 'canEdit', 'canDelete', 'canManage', 'canOwner'] as const).filter((k) => p[k]);
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone="muted" className="px-1.5 text-[10px]">
          {f.replace('can', '')}
        </Badge>
      ))}
    </div>
  );
}

function NewFolderModal({ parentId, moduleName, onClose }: { parentId?: string; moduleName: number; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [extensions, setExtensions] = useState('');
  const create = useMutation({
    mutationFn: () =>
      directories.create({
        name: name.trim(),
        parentDirectoryId: parentId,
        description: description.trim() || undefined,
        moduleName: parentId ? undefined : moduleName,
        allowedFileExtensions: extensions.split(',').map((x) => x.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New folder"
      footer={
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Allowed extensions" hint="Comma separated, e.g. .pdf,.png — empty allows all.">
        <Input value={extensions} onChange={(e) => setExtensions(e.target.value)} />
      </Field>
      {create.isError && <ErrorNote error={create.error} />}
    </Modal>
  );
}

function RenameModal({ obj, onClose }: { obj: StorageObject; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const [name, setName] = useState(obj.name);
  const rename = useMutation({
    mutationFn: (): Promise<unknown> =>
      obj.type === 'directory' ? directories.update(obj.itemId, { name: name.trim() }) : files.rename(obj.itemId, name.trim()),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Rename ${obj.type}`}
      footer={
        <Button disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()}>
          Save
        </Button>
      }
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {rename.isError && <ErrorNote error={rename.error} />}
    </Modal>
  );
}

function MoveModal({ obj, copy, onClose }: { obj: StorageObject; copy: boolean; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const [target, setTarget] = useState('');
  const [copyPolicies, setCopyPolicies] = useState(false);
  const dirs = useQuery({ queryKey: [...STORAGE_KEY, 'dir-picker'], queryFn: () => objects.list({ type: 'directory', moduleName: MODULES.Default_Cloud }) });
  const run = useMutation({
    mutationFn: (): Promise<unknown> => {
      if (obj.type === 'directory') return directories.move(obj.itemId, target.trim() || undefined);
      return copy ? files.copy(obj.itemId, target.trim(), copyPolicies) : files.move(obj.itemId, target.trim());
    },
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`${copy ? 'Copy' : 'Move'} “${obj.name}”`}
      footer={
        <Button disabled={(obj.type === 'file' && !target.trim()) || run.isPending} onClick={() => run.mutate()}>
          {copy ? 'Copy' : 'Move'}
        </Button>
      }
    >
      <Field label="Target directory id" hint={obj.type === 'directory' ? 'Empty moves it to the root.' : undefined}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="directory id" />
      </Field>
      {dirs.data?.items?.length ? (
        <div className="flex flex-wrap gap-1">
          {dirs.data.items.map((d) => (
            <Button key={d.itemId} variant="outline" size="sm" onClick={() => setTarget(d.itemId)}>
              <Folder className="h-3.5 w-3.5" /> {d.name}
            </Button>
          ))}
        </div>
      ) : null}
      {copy && <Checkbox label="Copy access policies too" checked={copyPolicies} onChange={setCopyPolicies} />}
      {run.isError && <ErrorNote error={run.error} />}
    </Modal>
  );
}

function DeleteModal({ obj, onClose }: { obj: StorageObject; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const delFile = useDeleteFile();
  const [permanent, setPermanent] = useState(false);
  const del = useMutation({
    mutationFn: (): Promise<unknown> =>
      obj.type === 'directory' ? directories.del(obj.itemId, permanent) : delFile.mutateAsync({ fileId: obj.itemId, permanent }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete “${obj.name}”?`}
      footer={
        <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
          {permanent ? 'Delete permanently' : 'Move to trash'}
        </Button>
      }
    >
      <Checkbox
        label="Delete permanently"
        hint="Skips the trash. A non-empty folder cannot be deleted permanently (409)."
        checked={permanent}
        onChange={setPermanent}
      />
      {del.isError && <ErrorNote error={del.error} />}
    </Modal>
  );
}

function DetailsModal({ obj, onClose }: { obj: StorageObject; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const detail = useQuery({
    queryKey: [...STORAGE_KEY, 'detail', obj.itemId],
    queryFn: (): Promise<unknown> => (obj.type === 'directory' ? directories.get(obj.itemId) : files.get(obj.itemId)),
  });
  const [props, setProps] = useState('{\n  "status": "reviewed"\n}');
  const save = useMutation({
    mutationFn: () => files.updateAdditionalInfo(obj.itemId, parseJsonInput<Record<string, string>>(props, 'Properties') ?? {}),
    onSuccess: () => {
      void invalidate();
      void detail.refetch();
    },
  });
  return (
    <Modal open onClose={onClose} title={obj.name} description={`${obj.type} · ${obj.itemId}`} className="max-w-2xl">
      {detail.isPending ? <Spinner /> : detail.isError ? <ErrorNote error={detail.error} /> : <JsonView value={detail.data} />}
      {obj.type === 'file' && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Additional properties</p>
          <Textarea mono rows={3} value={props} onChange={(e) => setProps(e.target.value)} />
          <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
            Save properties
          </Button>
          {save.isError && <ErrorNote error={save.error} />}
        </div>
      )}
    </Modal>
  );
}

function VersionsModal({ obj, onClose }: { obj: StorageObject; onClose: () => void }) {
  const invalidate = useInvalidateStorage();
  const versions = useQuery({ queryKey: [...STORAGE_KEY, 'versions', obj.itemId], queryFn: () => files.versions(obj.itemId) });
  const openVersion = useMutation({
    mutationFn: (no: number) => files.get(obj.itemId, { version: no }),
    onSuccess: (rec) => rec.url && window.open(rec.url, '_blank', 'noopener'),
  });
  const newVersion = useMutation({
    mutationFn: async (file: File) => {
      const v = await files.createVersion(obj.itemId);
      if (!v.uploadUrl) return v;
      const res = await trackedFetch(v.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...(/\.blob\.core\.windows\.net/i.test(v.uploadUrl) ? { 'x-ms-blob-type': 'BlockBlob' } : {}),
          ...(v.requiredHeaders ?? {}),
        },
        body: file,
      });
      if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
      if (v.uploadCompletionRequired && v.fileVersionId) await files.completeUpload(obj.itemId, v.fileVersionId);
      return v;
    },
    onSuccess: () => {
      void invalidate();
      void versions.refetch();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Versions of “${obj.name}”`} className="max-w-2xl">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
        <UploadCloud className="h-4 w-4" />
        {newVersion.isPending ? 'Uploading…' : 'Upload a new version'}
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) newVersion.mutate(f);
          }}
        />
      </label>
      {newVersion.isError && <ErrorNote error={newVersion.error} />}
      {versions.isPending ? (
        <Spinner />
      ) : versions.isError ? (
        <ErrorNote error={versions.error} />
      ) : (
        <ul className="divide-y text-sm">
          {(versions.data?.items ?? []).map((v) => (
            <li key={v.itemId} className="flex items-center justify-between gap-2 py-2">
              <span>
                v{v.no} · {prettyBytes(v.sizeInBytes)} · {formatDate(v.createdDate)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => openVersion.mutate(v.no)}>
                <Download className="h-3.5 w-3.5" /> Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const PRINCIPALS: PrincipalType[] = ['User', 'Role', 'Everyone', 'Organization'];
const PERMISSIONS: StoragePermission[] = ['View', 'Download', 'Edit', 'Delete', 'Manage', 'Owner'];

function AccessModal({ obj, onClose }: { obj: StorageObject; onClose: () => void }) {
  const resourceType = obj.type === 'directory' ? 'Directory' : 'File';
  const policies = useQuery({ queryKey: [...STORAGE_KEY, 'policies', obj.itemId], queryFn: () => objects.policies(obj.itemId) });
  const resolved = useQuery({ queryKey: [...STORAGE_KEY, 'resolve', obj.itemId], queryFn: () => objects.resolve(obj.itemId) });
  const refresh = () => {
    void policies.refetch();
    void resolved.refetch();
  };

  const [principalType, setPrincipalType] = useState<PrincipalType>('User');
  const [principalId, setPrincipalId] = useState('');
  const [permission, setPermission] = useState<StoragePermission>('View');
  const [effect, setEffect] = useState<'Allow' | 'Deny'>('Allow');
  const [expiresAt, setExpiresAt] = useState('');
  const [asShare, setAsShare] = useState(false);

  const grant = useMutation({
    mutationFn: () => {
      const input: PolicyInput = {
        resourceId: obj.itemId,
        resourceType,
        principalType,
        ...(principalType === 'Everyone' ? {} : principalType === 'Organization' ? { organizationId: principalId.trim() } : { principalId: principalId.trim() }),
        permission,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      };
      return asShare ? objects.share(input) : objects.grant({ ...input, effect });
    },
    onSuccess: refresh,
  });
  const revoke = useMutation({ mutationFn: (policyId: string) => objects.revoke(obj.itemId, policyId), onSuccess: refresh });
  const inherit = useMutation({ mutationFn: (v: boolean) => objects.toggleInheritance(obj.itemId, v), onSuccess: refresh });

  return (
    <Modal open onClose={onClose} title={`Access to “${obj.name}”`} className="max-w-3xl">
      <div>
        <p className="mb-1 text-sm font-medium">Your effective access (resolve-access)</p>
        {resolved.isError ? <ErrorNote error={resolved.error} /> : <PermissionBadges p={resolved.data} />}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={inherit.isPending} onClick={() => inherit.mutate(true)}>
          Inherit parent access
        </Button>
        <Button size="sm" variant="outline" disabled={inherit.isPending} onClick={() => inherit.mutate(false)}>
          Break inheritance
        </Button>
      </div>
      {inherit.isError && <ErrorNote error={inherit.error} />}

      <div>
        <p className="mb-1 text-sm font-medium">Policies (including inherited)</p>
        {policies.isPending ? (
          <Spinner />
        ) : policies.isError ? (
          <ErrorNote error={policies.error} />
        ) : !policies.data?.length ? (
          <p className="text-sm text-muted-foreground">No explicit policies.</p>
        ) : (
          <ul className="divide-y text-sm">
            {policies.data.map((p) => (
              <li key={p.itemId} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <Badge tone={String(p.effect) === 'Deny' || p.effect === 2 ? 'danger' : 'success'}>{String(p.effect)}</Badge>{' '}
                  {String(p.permission)} → {String(p.principalType)} <code className="text-xs">{p.principalId ?? p.organizationId ?? ''}</code>
                  {p.resourceId !== obj.itemId && <Badge tone="muted" className="ml-1">inherited</Badge>}
                  {p.expiresAt && <span className="ml-1 text-xs text-muted-foreground">until {formatDate(p.expiresAt)}</span>}
                </span>
                {p.resourceId === obj.itemId && (
                  <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(p.itemId)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {revoke.isError && <ErrorNote error={revoke.error} />}
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Grant / share</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={principalType} onChange={(e) => setPrincipalType(e.target.value as PrincipalType)}>
            {PRINCIPALS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          {principalType !== 'Everyone' && (
            <Input
              placeholder={principalType === 'Role' ? 'role slug' : principalType === 'Organization' ? 'organization id' : 'user id'}
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
            />
          )}
          <Select value={permission} onChange={(e) => setPermission(e.target.value as StoragePermission)}>
            {PERMISSIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          {!asShare && (
            <Select value={effect} onChange={(e) => setEffect(e.target.value as 'Allow' | 'Deny')}>
              <option>Allow</option>
              <option>Deny</option>
            </Select>
          )}
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} title="Expires at (optional)" />
        </div>
        <Checkbox label="Use share-object instead of grant-access" checked={asShare} onChange={setAsShare} />
        <Button size="sm" disabled={grant.isPending} onClick={() => grant.mutate()}>
          {asShare ? 'Share' : 'Grant'}
        </Button>
        {grant.isError && <ErrorNote error={grant.error} />}
      </div>
    </Modal>
  );
}

function SearchTab() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = useQuery({
    queryKey: [...STORAGE_KEY, 'search', submitted],
    queryFn: () => objects.search(submitted),
    enabled: !!submitted,
  });
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files and folders…" />
          <Button disabled={!q.trim()}>
            <Search className="h-4 w-4" /> Search
          </Button>
        </form>
        {search.isFetching ? (
          <Spinner />
        ) : search.isError ? (
          <ErrorNote error={search.error} />
        ) : search.data ? (
          search.data.items?.length ? (
            <ObjectTable items={search.data.items} />
          ) : (
            <EmptyState title="No matches" />
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function FlatList({ title, queryKey, fetchPage }: { title: string; queryKey: string; fetchPage: (cursor?: string) => Promise<ObjectPage> }) {
  const list = useInfiniteQuery({
    queryKey: [...STORAGE_KEY, queryKey],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ObjectPage) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : items.length ? (
          <ObjectTable items={items} />
        ) : (
          <EmptyState title="Nothing here" />
        )}
        {list.hasNextPage && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => list.fetchNextPage()}>
            Load more
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TrashTab() {
  const invalidate = useInvalidateStorage();
  const trash = useQuery({ queryKey: [...STORAGE_KEY, 'trash'], queryFn: () => objects.trash() });
  const restore = useMutation({ mutationFn: objects.restore, onSuccess: () => void invalidate() });
  const purge = useMutation({ mutationFn: objects.deleteForever, onSuccess: () => void invalidate() });
  const items = trash.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trash</CardTitle>
        <CardDescription>Restore puts an item back where it was; delete forever cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        {restore.isError && <ErrorNote error={restore.error} />}
        {purge.isError && <ErrorNote error={purge.error} />}
        {trash.isPending ? (
          <Spinner />
        ) : trash.isError ? (
          <ErrorNote error={trash.error} />
        ) : !items.length ? (
          <EmptyState title="Trash is empty" />
        ) : (
          <ul className="divide-y text-sm">
            {items.map((o) => (
              <li key={o.itemId} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  {o.type === 'directory' ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  {o.name}
                  <span className="text-xs text-muted-foreground">{formatDate(o.lastUpdatedDate)}</span>
                </span>
                <span className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(o.itemId)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <Button variant="destructive" size="sm" disabled={purge.isPending} onClick={() => purge.mutate(o.itemId)}>
                    Delete forever
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

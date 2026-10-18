import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, LockOpen, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { secrets, type Secret } from '@/features/os/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, splitList } from '@/components/ui/form';
import { CopyButton, JsonView, PageHeader } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

/**
 * The project secret store (Blocks OS → Secrets & Configs), driven as the signed-in user.
 *
 * Reading a value is the runtime path an app would use (`Secrets/value`, audited). Values
 * are fetched only on an explicit click and never cached — this page is for testing the
 * store's rules (type, access list, lock, soft delete), not for browsing secrets casually.
 */
export function SecretsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState<Secret | null>(null);
  const [auditFor, setAuditFor] = useState<Secret | 'all' | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const list = useQuery({ queryKey: ['os', 'secrets', search, includeDeleted], queryFn: () => secrets.list({ search: search.trim() || undefined, includeDeleted }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['os', 'secrets'] });
  const reveal = useMutation({
    mutationFn: (id: string) => secrets.value(id),
    onSuccess: (r, id) => setRevealed((prev) => ({ ...prev, [id]: r.value ?? '' })),
  });
  const act = useMutation({
    mutationFn: ({ id, op }: { id: string; op: 'lock' | 'unlock' | 'restore' | 'remove' }) => secrets[op](id),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Secrets"
        description="The project secret store: create, read at runtime, rotate, lock, soft-delete and audit."
        endpoints={['GET /os/v4/Secrets/gets', 'GET /os/v4/Secrets/value', 'POST /os/v4/Secrets/set', 'POST /os/v4/Secrets/rotate', 'GET /os/v4/Secrets/audit']}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAuditFor('all')}>
              Audit log
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New secret
            </Button>
          </>
        }
      />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
          <Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Checkbox label="Include deleted" checked={includeDeleted} onChange={setIncludeDeleted} />
        </CardHeader>
        <CardContent>
          {[reveal, act].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
          {list.isPending ? (
            <Spinner />
          ) : list.isError ? (
            <ErrorNote error={list.error} />
          ) : !list.data?.data?.length ? (
            <EmptyState title="No secrets" />
          ) : (
            <ul className="divide-y text-sm">
              {list.data.data.map((s) => {
                const shown = revealed[s.secretId];
                return (
                  <li key={s.secretId} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {s.name}{' '}
                          <Badge tone={s.status === 'active' ? 'success' : s.status === 'deleted' ? 'danger' : 'muted'}>{s.status}</Badge>{' '}
                          <Badge tone="muted">{s.type}</Badge>
                          {s.canReadValue === false && <Badge tone="muted" className="ml-1">no read access</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.description ? `${s.description} · ` : ''}rotated {s.rotationCount ?? 0}× · last {formatDate(s.lastRotatedDate ?? s.createdDate)}
                          {s.access && (s.access.roles?.length || s.access.userIds?.length)
                            ? ` · access: ${[...(s.access.roles ?? []), ...(s.access.userIds ?? [])].join(', ')}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={shown !== undefined ? 'Hide' : 'Read value'}
                          disabled={reveal.isPending}
                          onClick={() =>
                            shown !== undefined
                              ? setRevealed(({ [s.secretId]: _drop, ...rest }) => rest)
                              : reveal.mutate(s.secretId)
                          }
                        >
                          {shown !== undefined ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Rotate" onClick={() => setRotating(s)}>
                          <RotateCw className="h-3.5 w-3.5" />
                        </Button>
                        {s.status === 'locked' ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Unlock" onClick={() => act.mutate({ id: s.secretId, op: 'unlock' })}>
                            <LockOpen className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Lock" onClick={() => act.mutate({ id: s.secretId, op: 'lock' })}>
                            <Lock className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {s.status === 'deleted' ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Restore" onClick={() => act.mutate({ id: s.secretId, op: 'restore' })}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete (soft)" onClick={() => act.mutate({ id: s.secretId, op: 'remove' })}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setAuditFor(s)}>
                          Audit
                        </Button>
                      </div>
                    </div>
                    {shown !== undefined && (
                      <p className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-xs">
                        <span className="break-all">{shown || '(empty)'}</span>
                        <CopyButton text={shown} />
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      {creating && <CreateSecretModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); void refresh(); }} />}
      {rotating && <RotateModal secret={rotating} onClose={() => setRotating(null)} onDone={() => { setRotating(null); void refresh(); }} />}
      {auditFor && <AuditModal secret={auditFor === 'all' ? null : auditFor} onClose={() => setAuditFor(null)} />}
    </div>
  );
}

function CreateSecretModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [type, setType] = useState<'api' | 'service' | 'both'>('api');
  const [roles, setRoles] = useState('');
  const [userIds, setUserIds] = useState('');
  const create = useMutation({
    mutationFn: () =>
      secrets.set({
        name: name.trim(),
        value,
        description: description.trim() || undefined,
        tags: splitList(tags),
        type,
        access: { roles: splitList(roles), userIds: splitList(userIds) },
      }),
    onSuccess: onDone,
  });
  return (
    <Modal open onClose={onClose} title="New secret" footer={<Button disabled={!name.trim() || !value || create.isPending} onClick={() => create.mutate()}>Create</Button>}>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Value">
        <Textarea mono rows={2} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Type" hint="api: only the access list can read it · service: any caller with the permission · both.">
        <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="api">api</option>
          <option value="service">service</option>
          <option value="both">both</option>
        </Select>
      </Field>
      <Field label="Readable by roles">
        <Input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="comma separated slugs" />
      </Field>
      <Field label="Readable by user ids">
        <Input value={userIds} onChange={(e) => setUserIds(e.target.value)} />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Tags">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      {create.isError && <ErrorNote error={create.error} />}
    </Modal>
  );
}

function RotateModal({ secret, onClose, onDone }: { secret: Secret; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  const rotate = useMutation({ mutationFn: () => secrets.rotate(secret.secretId, value), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title={`Rotate “${secret.name}”`} description="Same id, access list and audit trail — new value." footer={<Button disabled={!value || rotate.isPending} onClick={() => rotate.mutate()}>Rotate</Button>}>
      <Textarea mono rows={2} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
      {rotate.isError && <ErrorNote error={rotate.error} />}
    </Modal>
  );
}

function AuditModal({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  const audit = useQuery({ queryKey: ['os', 'secrets', 'audit', secret?.secretId ?? 'all'], queryFn: () => secrets.audit(secret?.secretId), retry: false });
  return (
    <Modal open onClose={onClose} title={secret ? `Audit — ${secret.name}` : 'Secret audit log'} className="max-w-3xl">
      {audit.isPending ? <Spinner /> : audit.isError ? <ErrorNote error={audit.error} /> : <JsonView value={audit.data} maxHeight="max-h-[60vh]" />}
    </Modal>
  );
}

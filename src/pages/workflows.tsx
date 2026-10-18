import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Play, Plus, RefreshCw, Trash2, Upload, Zap } from 'lucide-react';
import {
  EXECUTION_MODE,
  EXECUTION_STATUS,
  functions,
  isTerminal,
  isTriggerNode,
  proxies,
  scheduler,
  workflows,
  type ExecutionSummary,
  type HttpMethod,
  type Schedule,
  type WorkflowDetail,
  type WorkflowNode,
} from '@/features/logic/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, parseJsonInput } from '@/components/ui/form';
import { CopyButton, DetailList, JsonView, PageHeader, Tabs } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

type Tab = 'workflows' | 'scheduler' | 'functions';

export function WorkflowsPage() {
  const [tab, setTab] = useState<Tab>('workflows');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Blocks Logic: trigger workflows by webhook, follow executions, schedule calls, invoke functions."
        endpoints={[
          'POST /logic/v4/Workflow/GetAll',
          'POST /logic/v4/Workflow/Webhook/{workflowId}/{nodeId}',
          'POST /logic/v4/Workflow/webhook-test/{workflowId}/{nodeId}',
          'GET /logic/v4/Workflow/GetExecutions',
          'POST /logic/v4/Scheduler/*',
          '/logic/v4/fn/{functionId}',
        ]}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'workflows', label: 'Workflows & executions' },
          { value: 'scheduler', label: 'Scheduler' },
          { value: 'functions', label: 'Functions & proxies' },
        ]}
      />
      {tab === 'workflows' && <WorkflowsTab />}
      {tab === 'scheduler' && <SchedulerTab />}
      {tab === 'functions' && <FunctionsTab />}
    </div>
  );
}

const statusTone = (s?: number) => (s === 4 ? 'success' : s === 5 ? 'danger' : 'default');

function WorkflowsTab() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['logic', 'workflows', search], queryFn: () => workflows.list({ search: search.trim() || undefined, pageSize: 100 }) });

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center justify-between text-base">
            Workflows
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </CardTitle>
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardHeader>
        <CardContent className="max-h-[65vh] overflow-y-auto">
          {list.isPending ? (
            <Spinner />
          ) : list.isError ? (
            <ErrorNote error={list.error} />
          ) : !list.data?.data?.length ? (
            <EmptyState title="No workflows" description="Build one in Blocks OS → Logic, or create an empty one here." />
          ) : (
            <ul className="space-y-0.5">
              {list.data.data.map((w) => (
                <li key={w.itemId}>
                  <button
                    className={cn('flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent', selected === w.itemId && 'bg-accent font-medium')}
                    onClick={() => setSelected(w.itemId)}
                  >
                    <span className="truncate">{w.name}</span>
                    <span className="flex shrink-0 gap-1">
                      {w.isPublished && <Badge tone="success">live</Badge>}
                      {w.isDirty && <Badge tone="muted">draft</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {selected ? (
        <WorkflowPanel key={selected} workflowId={selected} onDeleted={() => setSelected(null)} />
      ) : (
        <Card>
          <CardContent className="p-6">
            <EmptyState title="Pick a workflow" description="Its triggers, executions and versions show here." />
          </CardContent>
        </Card>
      )}
      {creating && <CreateWorkflowModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelected(id); }} />}
    </div>
  );
}

function CreateWorkflowModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('Construct OS test workflow');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState('[]');
  const create = useMutation({
    mutationFn: () => workflows.create({ name: name.trim(), description, nodes: parseJsonInput<unknown[]>(nodes, 'Nodes') ?? [] }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['logic', 'workflows'] });
      if (r.itemId) onCreated(r.itemId);
      else onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="New workflow" footer={<Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>}>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Nodes (JSON)" hint="Usually easier to build in the Blocks OS editor; empty is fine.">
        <Textarea mono rows={5} value={nodes} onChange={(e) => setNodes(e.target.value)} />
      </Field>
      {create.isError && <ErrorNote error={create.error} />}
    </Modal>
  );
}

function WorkflowPanel({ workflowId, onDeleted }: { workflowId: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const wf = useQuery({ queryKey: ['logic', 'workflow', workflowId], queryFn: () => workflows.get(workflowId) });
  const versions = useQuery({ queryKey: ['logic', 'versions', workflowId], queryFn: () => workflows.versions(workflowId), retry: false });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['logic'] });
  };
  const publish = useMutation({ mutationFn: () => workflows.publishNewVersion(workflowId, `v${new Date().toISOString().slice(0, 16)}`, 'Published from Construct OS'), onSuccess: refresh });
  const unpublish = useMutation({ mutationFn: () => workflows.unpublish(workflowId), onSuccess: refresh });
  const duplicate = useMutation({ mutationFn: () => workflows.duplicate(workflowId, `${wf.data?.data?.name ?? 'Workflow'} (copy)`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => workflows.remove(workflowId), onSuccess: () => { refresh(); onDeleted(); } });
  const publishVersion = useMutation({ mutationFn: (versionId: string) => workflows.publishVersion(workflowId, versionId), onSuccess: refresh });

  const detail = wf.data?.data as WorkflowDetail | undefined;
  const triggers = (detail?.nodes ?? []).filter(isTriggerNode);

  if (wf.isPending) return <Spinner />;
  if (wf.isError) return <ErrorNote error={wf.error} />;
  if (!detail) return <EmptyState title="Workflow not found" />;

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">{detail.name}</CardTitle>
            <CardDescription>
              <code>{detail.itemId}</code> · {detail.nodes?.length ?? 0} nodes ·{' '}
              {detail.isPublished ? <Badge tone="success">published {detail.publishedVersion?.name ?? ''}</Badge> : <Badge tone="muted">not published</Badge>}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
              <Upload className="h-3.5 w-3.5" /> Publish new version
            </Button>
            {detail.isPublished && (
              <Button size="sm" variant="outline" disabled={unpublish.isPending} onClick={() => unpublish.mutate()}>
                Unpublish
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {[publish, unpublish, duplicate, remove, publishVersion].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Nodes & edges (raw)</summary>
            <JsonView value={{ nodes: detail.nodes, edges: detail.edges, settings: detail.settings }} />
          </details>
        </CardContent>
      </Card>

      {triggers.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">This workflow has no trigger node yet.</CardContent>
        </Card>
      ) : (
        triggers.map((t) => <TriggerCard key={t.id} workflowId={workflowId} node={t} published={!!detail.isPublished} />)
      )}

      <ExecutionsCard workflowId={workflowId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.isPending ? (
            <Spinner />
          ) : versions.isError ? (
            <ErrorNote error={versions.error} />
          ) : !versions.data?.data?.length ? (
            <p className="text-sm text-muted-foreground">No versions yet — publishing creates one.</p>
          ) : (
            <ul className="divide-y text-sm">
              {versions.data.data.map((v) => (
                <li key={v.itemId} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {v.name} {v.isPublished && <Badge tone="success">published</Badge>}
                    <span className="ml-2 text-xs text-muted-foreground">{formatDate(v.createdDate)}</span>
                  </span>
                  {!v.isPublished && (
                    <Button size="sm" variant="outline" disabled={publishVersion.isPending} onClick={() => publishVersion.mutate(v.itemId)}>
                      Publish this
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TriggerCard({ workflowId, node, published }: { workflowId: string; node: WorkflowNode; published: boolean }) {
  const qc = useQueryClient();
  const isWebhook = node.type === 'webhook';
  const [payload, setPayload] = useState('{\n  "name": "Construct OS",\n  "email": "test@example.com"\n}');
  const [test, setTest] = useState(!published);
  const [executionId, setExecutionId] = useState<string | null>(null);

  const listen = useMutation({ mutationFn: (on: boolean) => workflows.listen(workflowId, node.id, on) });
  const fire = useMutation({
    mutationFn: () => workflows.trigger(workflowId, node.id, parseJsonInput(payload, 'Payload'), test),
    onSuccess: (r) => {
      setExecutionId(r.executionId ?? null);
      void qc.invalidateQueries({ queryKey: ['logic', 'executions', workflowId] });
    },
  });
  const step = useMutation({ mutationFn: () => workflows.stepExecute(workflowId, node.id) });
  const execution = useQuery({
    queryKey: ['logic', 'execution', executionId],
    queryFn: () => workflows.execution(executionId!),
    enabled: !!executionId,
    refetchInterval: (q) => (isTerminal(q.state.data?.data?.status) ? false : 2000),
  });

  const params = node.parameters ?? {};
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" /> Trigger: {node.name} <Badge tone="muted">{node.type}</Badge>
        </CardTitle>
        <CardDescription>
          {isWebhook ? (
            <>
              auth <code>{String(params.authType ?? 'none')}</code> · response mode <code>{String(params.httpResponseMode ?? 'immediate')}</code>
            </>
          ) : (
            'Not a webhook — it fires on its own schedule/event. Step-execute runs just this node.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isWebhook && (
          <>
            {[false, true].map((t) => (
              <div key={String(t)} className="flex items-center gap-1 text-xs">
                <Badge tone={t ? 'muted' : 'success'}>{t ? 'draft' : 'live'}</Badge>
                <code className="min-w-0 truncate">{workflows.webhookUrl(workflowId, node.id, t)}</code>
                <CopyButton text={workflows.webhookUrl(workflowId, node.id, t)} />
              </div>
            ))}
            <Textarea mono rows={5} value={payload} onChange={(e) => setPayload(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                label="Run the draft (webhook-test)"
                hint="Needs the test listener on; otherwise runs the published version."
                checked={test}
                onChange={setTest}
              />
              {test && (
                <>
                  <Button size="sm" variant="outline" disabled={listen.isPending} onClick={() => listen.mutate(true)}>
                    Start listening
                  </Button>
                  <Button size="sm" variant="ghost" disabled={listen.isPending} onClick={() => listen.mutate(false)}>
                    Stop
                  </Button>
                  {listen.isSuccess && <span className="text-xs text-emerald-600">listener updated</span>}
                </>
              )}
            </div>
            <Button disabled={fire.isPending} onClick={() => fire.mutate()}>
              <Play className="h-4 w-4" /> {fire.isPending ? 'Sending…' : 'POST to webhook'}
            </Button>
          </>
        )}
        {!isWebhook && (
          <Button variant="outline" disabled={step.isPending} onClick={() => step.mutate()}>
            Step-execute this node
          </Button>
        )}
        {[listen, fire, step].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
        {fire.data && <JsonView value={fire.data} maxHeight="max-h-40" />}
        {step.data && <JsonView value={step.data} maxHeight="max-h-40" />}
        {executionId && execution.data?.data && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <p>
              Execution <code className="text-xs">{executionId}</code>{' '}
              <Badge tone={statusTone(execution.data.data.status)}>{EXECUTION_STATUS[execution.data.data.status] ?? execution.data.data.status}</Badge>
              {!isTerminal(execution.data.data.status) && <span className="ml-2 text-xs text-muted-foreground">polling…</span>}
            </p>
            {execution.data.data.errorMessage && <ErrorNote error={execution.data.data.errorMessage} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionsCard({ workflowId }: { workflowId: string }) {
  const list = useQuery({ queryKey: ['logic', 'executions', workflowId], queryFn: () => workflows.executions(workflowId, { pageSize: 25 }), refetchInterval: 10_000 });
  const [open, setOpen] = useState<ExecutionSummary | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Executions</CardTitle>
          <CardDescription>{list.data?.totalCount ?? 0} total · refreshes every 10s</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => list.refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !list.data?.data?.length ? (
          <EmptyState title="No executions yet" />
        ) : (
          <ul className="divide-y text-sm">
            {list.data.data.map((e) => (
              <li key={e.id}>
                <button className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-accent/40" onClick={() => setOpen(e)}>
                  <span className="flex items-center gap-2">
                    <Badge tone={statusTone(e.status)}>{EXECUTION_STATUS[e.status] ?? e.status}</Badge>
                    <span className="text-xs text-muted-foreground">{EXECUTION_MODE[e.executionMode ?? 0]}</span>
                    <span>{formatDate(e.startedAt)}</span>
                  </span>
                  <span className="truncate text-xs text-destructive">{e.errorMessage}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {open && <ExecutionModal summary={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function ExecutionModal({ summary, onClose }: { summary: ExecutionSummary; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['logic', 'execution', summary.id], queryFn: () => workflows.execution(summary.id) });
  const logs = useQuery({ queryKey: ['logic', 'execution-logs', summary.id], queryFn: () => workflows.executionLogs(summary.id), retry: false });
  const resume = useMutation({ mutationFn: () => workflows.resume(summary.id) });
  return (
    <Modal open onClose={onClose} title="Execution" description={<code>{summary.id}</code>} className="max-w-3xl">
      <DetailList
        rows={[
          ['Status', EXECUTION_STATUS[summary.status]],
          ['Started', formatDate(summary.startedAt)],
          ['Finished', formatDate(summary.finishedAt)],
          ['Attempt', summary.attemptNumber ?? '—'],
          ['Trace id', logs.data?.data?.traceId ? <code className="text-xs">{logs.data.data.traceId}</code> : '—'],
        ]}
      />
      {summary.status === 5 && (
        <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => resume.mutate()}>
          Resume execution
        </Button>
      )}
      {resume.isError && <ErrorNote error={resume.error} />}
      {resume.data && <JsonView value={resume.data} maxHeight="max-h-32" />}
      <p className="text-sm font-medium">Logs</p>
      {logs.isPending ? (
        <Spinner />
      ) : logs.isError ? (
        <ErrorNote error={logs.error} />
      ) : (
        <div className="max-h-60 space-y-1 overflow-y-auto rounded-md bg-muted p-2 font-mono text-[11px]">
          {(logs.data?.data?.logs ?? []).map((l, i) => (
            <p key={i}>
              <span className="text-muted-foreground">{l.timestamp?.slice(11, 23)}</span> [{l.level}] {l.nodeName ? `${l.nodeName}: ` : ''}
              {l.message}
            </p>
          ))}
          {!logs.data?.data?.logs?.length && <p>No logs (availability {String(logs.data?.data?.availability ?? '—')}).</p>}
        </div>
      )}
      <p className="text-sm font-medium">Detail (node executions, items, snapshot)</p>
      {detail.isPending ? <Spinner /> : detail.isError ? <ErrorNote error={detail.error} /> : <JsonView value={detail.data?.data} />}
    </Modal>
  );
}

function SchedulerTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['logic', 'schedules'], queryFn: () => scheduler.list() });
  const rows: Schedule[] = Array.isArray(list.data) ? list.data : (list.data?.data ?? []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['logic', 'schedules'] });
  const remove = useMutation({ mutationFn: scheduler.remove, onSuccess: refresh });
  const toggle = useMutation({
    mutationFn: (s: Schedule) =>
      scheduler.update({
        itemId: s.itemId,
        name: s.name ?? '',
        description: s.description,
        cronExpression: s.cronExpression ?? '',
        isActive: !s.isActive,
        webhook: { url: s.webhook?.url ?? '', method: s.webhook?.method ?? 'POST', headers: s.webhook?.headers },
        ...(typeof s.payload === 'string' ? { payload: s.payload } : {}),
      }),
    onSuccess: refresh,
  });

  const [name, setName] = useState('Construct OS heartbeat');
  const [cron, setCron] = useState('*/5 * * * *');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('POST');
  const [headers, setHeaders] = useState('{}');
  const [payload, setPayload] = useState('{ "source": "scheduler" }');
  const create = useMutation({
    mutationFn: () =>
      scheduler.create({
        name: name.trim(),
        cronExpression: cron.trim(),
        payload,
        isActive: true,
        webhook: { url: url.trim(), method, headers: parseJsonInput<Record<string, string>>(headers, 'Headers') ?? {} },
      }),
    onSuccess: refresh,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedules</CardTitle>
          <CardDescription>Cron jobs that call a webhook — point one at a workflow's webhook URL to run it on a timer.</CardDescription>
        </CardHeader>
        <CardContent>
          {[remove, toggle].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
          {list.isPending ? (
            <Spinner />
          ) : list.isError ? (
            <ErrorNote error={list.error} />
          ) : !rows.length ? (
            <EmptyState title="No schedules" />
          ) : (
            <ul className="divide-y text-sm">
              {rows.map((s) => (
                <li key={s.itemId} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.name} <Badge tone={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'active' : 'paused'}</Badge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <code>{s.cronExpression}</code> → {s.webhook?.method} {s.webhook?.url}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(s)}>
                      {s.isActive ? 'Pause' : 'Resume'}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={remove.isPending} onClick={() => remove.mutate(s.itemId)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Cron expression">
            <Input className="font-mono" value={cron} onChange={(e) => setCron(e.target.value)} />
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Input placeholder="https://… webhook URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Field label="Headers (JSON)">
            <Textarea mono rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </Field>
          <Field label="Payload">
            <Textarea mono rows={3} value={payload} onChange={(e) => setPayload(e.target.value)} />
          </Field>
          <Button disabled={!name.trim() || !cron.trim() || !url.trim() || create.isPending} onClick={() => create.mutate()}>
            Create schedule
          </Button>
          {create.isError && <ErrorNote error={create.error} />}
        </CardContent>
      </Card>
    </div>
  );
}

const METHODS: HttpMethod[] = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];

function FunctionsTab() {
  const [fnId, setFnId] = useState('');
  const [fnPath, setFnPath] = useState('');
  const [fnMethod, setFnMethod] = useState<HttpMethod>('POST');
  const [fnBody, setFnBody] = useState('{ "hello": "world" }');
  const [wait, setWait] = useState('');
  const invoke = useMutation({ mutationFn: () => functions.invoke(fnId.trim(), fnPath, fnMethod, parseJsonInput(fnBody, 'Body'), wait ? Number(wait) : undefined) });
  const run = invoke.data?.body as { runId?: string; pollToken?: string } | undefined;
  const poll = useMutation({ mutationFn: () => functions.result(run!.runId!, run!.pollToken!) });

  const [slug, setSlug] = useState('');
  const [pxPath, setPxPath] = useState('');
  const [pxMethod, setPxMethod] = useState<HttpMethod>('GET');
  const [pxBody, setPxBody] = useState('');
  const proxy = useMutation({ mutationFn: () => proxies.call(slug.trim(), pxPath, pxMethod, parseJsonInput(pxBody, 'Body')) });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoke a function</CardTitle>
          <CardDescription>
            <code>/logic/v4/fn/{'{functionId}'}/…</code> — async by default (202 + runId/pollToken); <code>Prefer: wait=N</code> waits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Function id" value={fnId} onChange={(e) => setFnId(e.target.value)} />
          <div className="grid grid-cols-[6rem_1fr_6rem] gap-2">
            <Select value={fnMethod} onChange={(e) => setFnMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Input placeholder="sub-path (optional)" value={fnPath} onChange={(e) => setFnPath(e.target.value)} />
            <Input type="number" placeholder="wait s" value={wait} onChange={(e) => setWait(e.target.value)} />
          </div>
          {fnMethod !== 'GET' && <Textarea mono rows={4} value={fnBody} onChange={(e) => setFnBody(e.target.value)} />}
          <Button disabled={!fnId.trim() || invoke.isPending} onClick={() => invoke.mutate()}>
            <Play className="h-4 w-4" /> Invoke
          </Button>
          {invoke.isError && <ErrorNote error={invoke.error} />}
          {invoke.data && (
            <>
              <Badge tone={invoke.data.ok ? 'success' : 'danger'}>{invoke.data.ok ? '2xx' : invoke.data.status}</Badge>
              <JsonView value={invoke.data.body} maxHeight="max-h-48" />
              {run?.runId && run.pollToken && (
                <Button size="sm" variant="outline" disabled={poll.isPending} onClick={() => poll.mutate()}>
                  Poll result
                </Button>
              )}
            </>
          )}
          {poll.data && <JsonView value={poll.data} maxHeight="max-h-48" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call a proxy</CardTitle>
          <CardDescription>
            <code>/logic/v4/proxy/gateway/{'{slug}'}/…</code> — relays the upstream's status and body.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Proxy slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Select value={pxMethod} onChange={(e) => setPxMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Input placeholder="sub-path (optional)" value={pxPath} onChange={(e) => setPxPath(e.target.value)} />
          </div>
          {pxMethod !== 'GET' && <Textarea mono rows={4} value={pxBody} onChange={(e) => setPxBody(e.target.value)} placeholder="{ }" />}
          <Button disabled={!slug.trim() || proxy.isPending} onClick={() => proxy.mutate()}>
            <Play className="h-4 w-4" /> Send
          </Button>
          {proxy.isError && <ErrorNote error={proxy.error} />}
          {proxy.data && (
            <>
              <Badge tone={proxy.data.ok ? 'success' : 'danger'}>{proxy.data.ok ? '2xx' : proxy.data.status}</Badge>
              <JsonView value={proxy.data.body} maxHeight="max-h-48" />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

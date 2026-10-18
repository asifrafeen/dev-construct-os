import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  MONITOR_BASE,
  MONITOR_KIND,
  MONITOR_SOURCE,
  monitor,
  sendHeartbeat,
  useHeartbeat,
  type MonitorConfig,
} from '@/features/monitor/api';
import { useMe } from '@/features/users/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, splitList } from '@/components/ui/form';
import { CopyButton, DetailList, JsonView, PageHeader } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

export function MonitorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitor"
        description="Uptime monitors for this deployment: a heartbeat this app sends, and request checks against its /healthz."
        endpoints={[
          `GET ${MONITOR_BASE.replace(/^https?:\/\/[^/]+/, '')}/Health/Ping/{itemId}`,
          'POST …/Health/SaveHealth',
          'POST …/Monitor/SaveMonitor',
          'GET …/Monitor/GetMonitorList',
          'GET …/Monitor/GetIncidentList',
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <HeartbeatCard />
        <CreateCard />
      </div>
      <MonitorsCard />
    </div>
  );
}

function HeartbeatCard() {
  const hb = useHeartbeat();
  const [pinging, setPinging] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4" /> Heartbeat sender
        </CardTitle>
        <CardDescription>
          This browser pings a heartbeat monitor while the app is open. Stop it for longer than interval + grace to raise an
          incident; resume to resolve it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Heartbeat monitor id" hint="Seeded from VITE_BLOCKS_HEARTBEAT_ID; created below if you don't have one.">
          <Input value={hb.monitorId} onChange={(e) => hb.configure({ monitorId: e.target.value.trim() })} />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Every (seconds)">
            <Input type="number" min={5} className="w-28" value={hb.intervalSeconds} onChange={(e) => hb.configure({ intervalSeconds: Number(e.target.value) })} />
          </Field>
          <Checkbox label="Send automatically" checked={hb.enabled} onChange={(v) => hb.configure({ enabled: v })} />
          <Button
            variant="outline"
            disabled={!hb.monitorId || pinging}
            onClick={async () => {
              setPinging(true);
              await sendHeartbeat();
              setPinging(false);
            }}
          >
            Ping now
          </Button>
        </div>
        {hb.lastPingAt && (
          <p className="text-sm">
            <Badge tone={hb.lastOk ? 'success' : 'danger'}>{hb.lastOk ? 'ok' : 'failed'}</Badge>{' '}
            <span className="text-muted-foreground">{formatDate(hb.lastPingAt)} — </span>
            {hb.lastResult}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CreateCard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const hb = useHeartbeat();
  const [kind, setKind] = useState<'heartbeat' | 'request'>('request');
  const [name, setName] = useState('Construct OS');
  const [url, setUrl] = useState(`${window.location.origin}/healthz`);
  const [method, setMethod] = useState<'GET' | 'HEAD' | 'POST'>('GET');
  const [interval, setInterval_] = useState('60');
  const [grace, setGrace] = useState('30');
  const [expected, setExpected] = useState('');
  const [emails, setEmails] = useState(me?.email ?? '');
  const create = useMutation({
    mutationFn: () =>
      kind === 'heartbeat'
        ? monitor.saveHeartbeat({ name: `${name} heartbeat`, intervalInSeconds: Number(interval), gracePeriodInSeconds: Number(grace), emails: splitList(emails) })
        : monitor.saveRequestMonitor({
            name,
            url: url.trim(),
            httpMethodType: method,
            intervalInSeconds: Number(interval),
            timeoutInSeconds: 30,
            successHttpResponseCodes: ['200'],
            ...(expected.trim() ? { expectedContent: expected.trim() } : {}),
            emails: splitList(emails),
          }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['monitor'] });
      if (kind === 'heartbeat' && r.data?.itemId) hb.configure({ monitorId: r.data.itemId });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" /> New monitor
        </CardTitle>
        <CardDescription>A heartbeat's id is wired into the sender on the left automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={kind} onChange={(e) => setKind(e.target.value as 'heartbeat' | 'request')}>
          <option value="request">Request — Monitor calls this app</option>
          <option value="heartbeat">Heartbeat — this app calls Monitor</option>
        </Select>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'request' && (
          <>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option>GET</option>
                <option>HEAD</option>
                <option>POST</option>
              </Select>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              URLs must be unique across all monitors. Try <code>/healthz</code>, <code>/version.json</code>, or <code>/</code>.
            </p>
            <Field label="Expected content (optional)">
              <Input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder='"status":"ok"' />
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Interval (s)">
            <Input type="number" value={interval} onChange={(e) => setInterval_(e.target.value)} />
          </Field>
          {kind === 'heartbeat' && (
            <Field label="Grace (s)">
              <Input type="number" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Alert emails">
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} />
        </Field>
        <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          Create
        </Button>
        {create.isError && <ErrorNote error={create.error} />}
        {create.data && <JsonView value={create.data} maxHeight="max-h-40" />}
      </CardContent>
    </Card>
  );
}

function MonitorsCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['monitor', 'list'], queryFn: () => monitor.list(), retry: false });
  const [open, setOpen] = useState<MonitorConfig | null>(null);
  const del = useMutation({
    mutationFn: (m: MonitorConfig) => (m.monitorConfigurationType === 1 ? monitor.deleteHeartbeat(m.itemId) : monitor.deleteMonitor(m.itemId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitor'] }),
  });
  const rows = list.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">This project's monitors</CardTitle>
          <CardDescription>Bars are the last 24h of incidents. Click a row for incidents, response times and downtime.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => list.refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {del.isError && <ErrorNote error={del.error} />}
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !rows.length ? (
          <EmptyState title="No monitors" description="Create one above." />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((m) => (
              <li key={m.itemId} className="flex items-center justify-between gap-3 py-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(m)}>
                  <p className="flex items-center gap-2 font-medium">
                    <span className={cn('h-2.5 w-2.5 rounded-full', m.currentStatus ? 'bg-emerald-500' : 'bg-destructive')} />
                    {m.name}
                    <Badge tone="muted">{MONITOR_KIND[m.monitorConfigurationType ?? 0]}</Badge>
                    {!m.isActive && <Badge tone="muted">paused</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.url} · every {m.intervalInSeconds}s · {MONITOR_SOURCE[m.monitorSourceType ?? 0]} · checked {formatDate(m.lastCheckedAt)}
                  </p>
                </button>
                <span className="hidden gap-0.5 sm:flex" title="Incidents in the last 24h">
                  {(m.incidentSummaries ?? []).slice(-24).map((i, idx) => (
                    <span key={idx} className="h-4 w-1 rounded-sm bg-destructive/70" title={`${formatDate(i.startTime)} – ${i.downtimeDurationSeconds}s`} />
                  ))}
                </span>
                {m.monitorConfigurationType === 1 && m.url && <CopyButton text={m.url} />}
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={del.isPending} onClick={() => del.mutate(m)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {open && <MonitorModal m={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function MonitorModal({ m, onClose }: { m: MonitorConfig; onClose: () => void }) {
  const details = useQuery({ queryKey: ['monitor', 'details', m.itemId], queryFn: () => monitor.details(m.itemId), retry: false });
  const incidents = useQuery({ queryKey: ['monitor', 'incidents', m.itemId], queryFn: () => monitor.incidents(m.itemId), retry: false });
  const rt = useQuery({ queryKey: ['monitor', 'rt', m.itemId], queryFn: () => monitor.responseTime(m.itemId), retry: false, enabled: m.monitorConfigurationType !== 1 });
  const points = rt.data?.data ?? [];
  const max = Math.max(1, ...points.map((p) => p.responseTimeMs ?? 0));

  return (
    <Modal open onClose={onClose} title={m.name ?? 'Monitor'} description={<code>{m.itemId}</code>} className="max-w-3xl">
      <DetailList
        rows={[
          ['Kind', MONITOR_KIND[m.monitorConfigurationType ?? 0]],
          ['URL', <span className="break-all font-mono text-xs">{m.url}</span>],
          ['Status', m.currentStatus ? 'Up' : 'Down'],
          ['Interval / timeout / grace', `${m.intervalInSeconds}s / ${m.timeoutInSeconds ?? '—'}s / ${m.gracePeriodInSeconds ?? '—'}s`],
          ['Alert emails', (m.emails ?? []).join(', ') || '—'],
        ]}
      />
      {m.monitorConfigurationType !== 1 && (
        <div>
          <p className="mb-1 text-sm font-medium">Response time (last hour)</p>
          {rt.isError ? (
            <ErrorNote error={rt.error} />
          ) : points.length ? (
            <div className="flex h-24 items-end gap-px rounded-md border p-2">
              {points.slice(-120).map((p, i) => (
                <span
                  key={i}
                  className={cn('flex-1 rounded-t-sm', p.statusCode && p.statusCode >= 400 ? 'bg-destructive' : 'bg-primary/70')}
                  style={{ height: `${Math.max(4, ((p.responseTimeMs ?? 0) / max) * 100)}%` }}
                  title={`${formatDate(p.timestamp)} · ${p.responseTimeMs} ms · ${p.statusCode}`}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No samples yet.</p>
          )}
        </div>
      )}
      <p className="text-sm font-medium">Summary (7d / 30d / 365d)</p>
      {details.isPending ? <Spinner /> : details.isError ? <ErrorNote error={details.error} /> : <JsonView value={details.data} maxHeight="max-h-48" />}
      <p className="text-sm font-medium">Incidents</p>
      {incidents.isPending ? <Spinner /> : incidents.isError ? <ErrorNote error={incidents.error} /> : <JsonView value={incidents.data?.data ?? incidents.data} maxHeight="max-h-60" />}
    </Modal>
  );
}

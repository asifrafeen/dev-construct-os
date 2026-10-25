import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { lmt, type Span } from '@/features/os/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { JsonView, PageHeader, Pager, Tabs } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

type Tab = 'traces' | 'logs' | 'analytics';
const RANGES: [string, number][] = [
  ['Last 15 minutes', 15],
  ['Last hour', 60],
  ['Last 6 hours', 360],
  ['Last 24 hours', 1440],
  ['Last 7 days', 10080],
];

function range(minutes: number) {
  const end = new Date();
  return { startDate: new Date(end.getTime() - minutes * 60_000).toISOString(), endDate: end.toISOString() };
}

/**
 * LMT for this project, read through the OS service — the server-side view of the same
 * calls the API inspector records client-side. `?traceId=` opens a trace directly.
 */
export function ObservabilityPage() {
  const [params, setParams] = useSearchParams();
  const traceParam = params.get('traceId');
  const [tab, setTab] = useState<Tab>('traces');
  const services = useQuery({ queryKey: ['lmt', 'services'], queryFn: lmt.services, retry: false, staleTime: 10 * 60_000 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Observability"
        description="Traces and logs Blocks recorded for this project's API traffic (LMT)."
        endpoints={['GET /os/v4/Trace/GetBlocksServices', 'POST /os/v4/Trace/GetTraces', 'GET /os/v4/Trace/GetTrace', 'POST /os/v4/Log/GetLogs']}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'traces', label: 'Traces' },
          { value: 'logs', label: 'Logs' },
          { value: 'analytics', label: 'Service analytics' },
        ]}
      />
      {services.isError && <ErrorNote error={services.error} />}
      {tab === 'traces' && (
        <TracesTab
          services={services.data ?? []}
          openTraceId={traceParam}
          onOpen={(id) => setParams(id ? { traceId: id } : {})}
        />
      )}
      {tab === 'logs' && <LogsTab services={services.data ?? []} />}
      {tab === 'analytics' && <AnalyticsTab services={services.data ?? []} />}
    </div>
  );
}

type Svc = { key?: string; label?: string; apiServiceName?: string };
const svcName = (s: Svc) => s.apiServiceName ?? s.key ?? s.label ?? '';

function TracesTab({ services, openTraceId, onOpen }: { services: Svc[]; openTraceId: string | null; onOpen: (id: string | null) => void }) {
  const [service, setService] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [statusClass, setStatusClass] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [lookup, setLookup] = useState(openTraceId ?? '');
  const pageSize = 25;

  const traces = useQuery({
    queryKey: ['lmt', 'traces', service, minutes, statusClass, search, page],
    queryFn: () =>
      lmt.traces({
        page,
        pageSize,
        ...(search.trim() ? { search: search.trim() } : {}),
        filter: { ...range(minutes), services: service ? [service] : [], ...(statusClass ? { statusCodeClasses: [statusClass] } : {}) },
      }),
    retry: false,
  });
  const total = traces.data?.totalCount ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Select className="w-48" value={service} onChange={(e) => { setService(e.target.value); setPage(0); }}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={svcName(s)} value={svcName(s)}>
                {s.label ?? svcName(s)}
              </option>
            ))}
          </Select>
          <Select className="w-40" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {RANGES.map(([l, m]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </Select>
          <Select className="w-32" value={statusClass} onChange={(e) => setStatusClass(e.target.value)}>
            <option value="">Any status</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </Select>
          <Input className="max-w-xs" placeholder="Search operation…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="ghost" size="icon" onClick={() => traces.refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <form
            className="ml-auto flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (lookup.trim()) onOpen(lookup.trim());
            }}
          >
            <Input className="w-64 font-mono text-xs" placeholder="Open trace by id…" value={lookup} onChange={(e) => setLookup(e.target.value)} />
            <Button variant="outline" size="icon">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {openTraceId && <TraceDetail traceId={openTraceId} onClose={() => onOpen(null)} />}

      <Card>
        <CardContent className="p-0">
          {traces.isPending ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : traces.isError ? (
            <div className="p-5">
              <ErrorNote error={traces.error} />
            </div>
          ) : !traces.data?.data?.length ? (
            <div className="p-5">
              <EmptyState title="No traces in this window" />
            </div>
          ) : (
            <ul className="divide-y text-sm">
              {traces.data.data.map((t) => (
                <li key={`${t.traceId}-${t.startTime}`}>
                  <button
                    className={cn('flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/40', openTraceId === t.traceId && 'bg-accent')}
                    onClick={() => onOpen(t.traceId)}
                  >
                    <Badge tone={/error/i.test(t.status ?? '') ? 'danger' : 'success'} className="w-16 justify-center">
                      {t.status ?? '—'}
                    </Badge>
                    <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{t.serviceName}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.operationName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDuration(t.duration)}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{formatDate(t.startTime ?? t.timestamp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager zeroBased page={page} pageCount={Math.ceil(total / pageSize)} total={total} onChange={setPage} />
    </div>
  );
}

/** Durations come back in ms or as a .NET TimeSpan-ish number; show something readable either way. */
function fmtDuration(d?: number) {
  if (d === undefined || d === null) return '—';
  return d >= 1000 ? `${(d / 1000).toFixed(2)} s` : `${Math.round(d)} ms`;
}

function TraceDetail({ traceId, onClose }: { traceId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['lmt', 'trace', traceId], queryFn: () => lmt.trace(traceId), retry: false });
  const spans: Span[] = useMemo(() => (Array.isArray(q.data) ? q.data : (q.data?.data ?? [])), [q.data]);
  const [selected, setSelected] = useState<Span | null>(null);

  const t0 = Math.min(...spans.map((s) => new Date(s.startTime ?? 0).getTime()));
  const t1 = Math.max(...spans.map((s) => new Date(s.endTime ?? s.startTime ?? 0).getTime()));
  const total = Math.max(1, t1 - t0);
  const ordered = [...spans].sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());
  const serviceForLogs = spans.find((s) => s.serviceName)?.serviceName;
  const logs = useQuery({
    queryKey: ['lmt', 'trace-logs', traceId, serviceForLogs],
    queryFn: () => lmt.logs({ serviceName: serviceForLogs, filter: { traceId } }),
    enabled: !!serviceForLogs,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Trace</CardTitle>
          <CardDescription>
            <code>{traceId}</code> · {spans.length} spans · {fmtDuration(total)}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isPending ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : !spans.length ? (
          <EmptyState title="Trace not found" description="It may be outside retention, or belong to another tenant." />
        ) : (
          <div className="space-y-1">
            {ordered.map((s) => {
              const start = new Date(s.startTime ?? 0).getTime() - t0;
              const dur = Math.max(new Date(s.endTime ?? s.startTime ?? 0).getTime() - new Date(s.startTime ?? 0).getTime(), 0);
              return (
                <button key={s.spanId} className="grid w-full grid-cols-[14rem_1fr] items-center gap-2 text-left text-xs hover:bg-accent/40" onClick={() => setSelected(s)}>
                  <span className="truncate" title={s.operationName}>
                    <span className="text-muted-foreground">{s.serviceName}</span> {s.operationName}
                  </span>
                  <span className="relative h-4 rounded bg-muted">
                    <span
                      className={cn('absolute top-0 h-4 rounded', /error/i.test(s.status ?? '') ? 'bg-destructive' : 'bg-primary/70')}
                      style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.5, (dur / total) * 100)}%` }}
                      title={`${dur} ms`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selected && <JsonView value={selected} maxHeight="max-h-64" />}
        {serviceForLogs && (
          <div>
            <p className="mb-1 text-sm font-medium">Logs for this trace ({serviceForLogs})</p>
            {logs.isPending ? <Spinner /> : logs.isError ? <ErrorNote error={logs.error} /> : <LogList rows={logs.data?.data ?? []} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogList({ rows }: { rows: { timestamp?: string; level?: string; message?: string; traceId?: string; actionName?: string; exception?: string }[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No log lines.</p>;
  return (
    <div className="max-h-[50vh] space-y-0.5 overflow-y-auto rounded-md bg-muted p-2 font-mono text-[11px]">
      {rows.map((l, i) => (
        <div key={i}>
          <span className="text-muted-foreground">{l.timestamp?.replace('T', ' ').slice(0, 23)}</span>{' '}
          <span className={cn(/err/i.test(l.level ?? '') ? 'text-destructive' : /warn/i.test(l.level ?? '') ? 'text-amber-600' : 'text-primary')}>
            {l.level}
          </span>{' '}
          {l.actionName && <span className="text-muted-foreground">[{l.actionName}] </span>}
          {l.message}
          {l.exception && <pre className="whitespace-pre-wrap text-destructive">{l.exception}</pre>}
        </div>
      ))}
    </div>
  );
}

function LogsTab({ services }: { services: Svc[] }) {
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [search, setSearch] = useState('');
  const [traceId, setTraceId] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const effective = service || svcName(services[0] ?? {});
  const logs = useQuery({
    queryKey: ['lmt', 'logs', effective, level, minutes, search, traceId, page],
    queryFn: () =>
      lmt.logs({
        page,
        pageSize,
        serviceName: effective,
        ...(search.trim() ? { search: search.trim() } : {}),
        filter: { ...range(minutes), ...(level ? { level } : {}), ...(traceId.trim() ? { traceId: traceId.trim() } : {}) },
      }),
    enabled: !!effective,
    retry: false,
  });
  const total = logs.data?.totalCount ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Select className="w-48" value={effective} onChange={(e) => setService(e.target.value)}>
            {services.map((s) => (
              <option key={svcName(s)} value={svcName(s)}>
                {s.label ?? svcName(s)}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Any level</option>
            <option>Information</option>
            <option>Warning</option>
            <option>Error</option>
          </Select>
          <Select className="w-40" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {RANGES.map(([l, m]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder="Search message…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input className="w-56 font-mono text-xs" placeholder="trace id" value={traceId} onChange={(e) => setTraceId(e.target.value)} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          {!effective ? (
            <EmptyState title="No services" description="GetBlocksServices returned nothing to read logs from." />
          ) : logs.isPending ? (
            <Spinner />
          ) : logs.isError ? (
            <ErrorNote error={logs.error} />
          ) : (
            <LogList rows={logs.data?.data ?? []} />
          )}
          <Pager zeroBased page={page} pageCount={Math.ceil(total / pageSize)} total={total} onChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsTab({ services }: { services: Svc[] }) {
  const [service, setService] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const run = useMutation({
    mutationFn: () => {
      const { startDate, endDate } = range(minutes);
      return lmt.serviceAnalytics(startDate, endDate, service || undefined);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Service analytics</CardTitle>
        <CardDescription>POST /os/v4/Trace/GetServiceAnalytics — request counts, errors and latency (needs trace::get-analytics).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select className="w-48" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={svcName(s)} value={svcName(s)}>
                {s.label ?? svcName(s)}
              </option>
            ))}
          </Select>
          <Select className="w-40" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {RANGES.map(([l, m]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </Select>
          <Button disabled={run.isPending} onClick={() => run.mutate()}>
            Run
          </Button>
        </div>
        {run.isError && <ErrorNote error={run.error} />}
        {run.data !== undefined && <JsonView value={run.data} maxHeight="max-h-[60vh]" />}
      </CardContent>
    </Card>
  );
}

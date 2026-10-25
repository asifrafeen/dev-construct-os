import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play, Trash2 } from 'lucide-react';
import { useApiLog, type ApiLogEntry } from '@/state/api-log';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, EmptyState, Input } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { CopyButton, DetailList, JsonView, PageHeader } from '@/components/ui/layout';
import { cn } from '@/lib/utils';

function statusTone(e: ApiLogEntry): 'success' | 'danger' | 'muted' | 'default' {
  if (e.status === null) return 'danger';
  if (e.ok) return 'success';
  if (e.status === 401 || e.status === 403) return 'default';
  return 'danger';
}

/**
 * Every Blocks call this tab has made. Pick one to see the redacted request and the
 * response, and copy its trace id into Blocks OS → LMT → Traces to find the server side.
 */
export function ApiLogPage() {
  const { entries, paused, clear, setPaused } = useApiLog();
  const [service, setService] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const services = useMemo(
    () => Array.from(new Set(entries.map((e) => e.service).filter(Boolean))).sort(),
    [entries],
  );

  const rows = entries.filter(
    (e) =>
      (!service || e.service === service) &&
      (!onlyErrors || !e.ok) &&
      (!search.trim() || e.url.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const failures = entries.filter((e) => !e.ok).length;
  const avg = entries.length
    ? Math.round(entries.reduce((sum, e) => sum + e.durationMs, 0) / entries.length)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="API inspector"
        description="Every Blocks request this tab made — newest first, credentials redacted, kept in memory only."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="outline" size="sm" onClick={clear}>
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{entries.length}</p>
            <p className="text-xs text-muted-foreground">Requests captured</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className={cn('text-2xl font-semibold', failures && 'text-destructive')}>{failures}</p>
            <p className="text-xs text-muted-foreground">Failed (non-2xx or network)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{avg} ms</p>
            <p className="text-xs text-muted-foreground">Average latency</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-40" value={service} onChange={(e) => setService(e.target.value)}>
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Filter by URL…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Failures only
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No requests yet"
                  description="Use any page in the app — its Blocks calls show up here as they happen."
                />
              </div>
            ) : (
              <ul className="max-h-[70vh] divide-y overflow-y-auto">
                {rows.map((e) => (
                  <li key={e.id}>
                    <button
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent/50',
                        e.id === selectedId && 'bg-accent',
                      )}
                      onClick={() => setSelectedId(e.id)}
                    >
                      <Badge tone={statusTone(e)} className="w-12 justify-center font-mono">
                        {e.status ?? 'ERR'}
                      </Badge>
                      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{e.method}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={e.url}>
                        {shortUrl(e.url)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{e.durationMs} ms</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="space-y-4 p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a request to see its details.</p>
            ) : (
              <>
                <DetailList
                  rows={[
                    ['Request', <span className="font-mono text-xs">{selected.method} {selected.url}</span>],
                    ['Status', selected.status ?? `Network error — ${selected.error}`],
                    ['Duration', `${selected.durationMs} ms`],
                    ['Started', new Date(selected.startedAt).toLocaleString()],
                    ['Service', selected.service || '—'],
                    [
                      'Trace id',
                      selected.traceId ? (
                        <span className="flex flex-wrap items-center gap-1 font-mono text-xs">
                          {selected.traceId}
                          <CopyButton text={selected.traceId} />
                          <Link className="font-sans text-primary underline" to={`/observability?traceId=${encodeURIComponent(selected.traceId)}`}>
                            open in Observability
                          </Link>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not exposed to the browser (needs Access-Control-Expose-Headers on the gateway).
                        </span>
                      ),
                    ],
                  ]}
                />
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Request body
                  </p>
                  <JsonView value={selected.requestBody} maxHeight="max-h-60" />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Response body
                  </p>
                  <JsonView value={selected.responseBody} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

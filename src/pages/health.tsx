import { useQueries } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { BLOCKS } from '@/lib/env';
import { BlocksError, blocksFetch, UnauthorizedError } from '@/lib/blocks-client';
import { MONITOR_BASE } from '@/features/monitor/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/layout';

/**
 * One cheap request per Blocks service, as the signed-in user.
 *
 * "Reachable" and "allowed" are reported separately on purpose: a 403 proves the gateway
 * routed the call and the service answered — it is a permission finding, not an outage.
 * Only a network/CORS failure, a 404 on the route, or a 5xx counts as down.
 */

interface Probe {
  service: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Called without the session (public endpoints). */
  anonymous?: boolean;
}

const API = BLOCKS.apiUrl;
const PROBES: Probe[] = [
  { service: 'IAM', label: 'Login options (public)', method: 'GET', path: `${API}/iam/v4/auth/login-options`, anonymous: true },
  { service: 'IAM', label: 'Current user', method: 'GET', path: `${API}/iam/v4/iam/me` },
  { service: 'Data', label: 'Gateway', method: 'POST', path: `${API}/data/v4/gateway`, body: { query: '{ __typename }' } },
  { service: 'Data', label: 'Schemas', method: 'GET', path: `${API}/data/v4/schemas?PageNo=1&PageSize=1` },
  { service: 'Data', label: 'Storage objects', method: 'GET', path: `${API}/data/v4/objects/get-objects?Limit=1` },
  { service: 'Localization', label: 'Languages (public)', method: 'GET', path: `${API}/localization/v4/Language/Gets`, anonymous: true },
  { service: 'Logic', label: 'Notifier inbox', method: 'GET', path: `${API}/logic/v4/Notifier/GetNotifications?Page=0&PageSize=1` },
  { service: 'Logic', label: 'Workflows', method: 'POST', path: `${API}/logic/v4/Workflow/GetAll`, body: { pageNumber: 0, pageSize: 1 } },
  { service: 'Logic', label: 'Mail configurations', method: 'GET', path: `${API}/logic/v4/Mail/Gets` },
  { service: 'Utilities', label: 'Magic links', method: 'GET', path: `${API}/utilities/v4/MagicLink/GetLinks?PageSize=1&PageNumber=0&ProjectKey=${BLOCKS.projectKey}` },
  { service: 'Utilities', label: 'Entitlements', method: 'GET', path: `${API}/utilities/v4/entitlements` },
  { service: 'Agents', label: 'Agent list', method: 'POST', path: `${API}/agents/v4/agents/queries`, body: { limit: 1, offset: 0 } },
  { service: 'Monitor', label: 'Monitor list', method: 'GET', path: `${MONITOR_BASE}/Monitor/GetMonitorList?projectKey=${BLOCKS.projectKey}&pageNumber=0&pageSize=1` },
  { service: 'Release', label: 'Test ping (public)', method: 'GET', path: `${API}/release/v4/auth/testping`, anonymous: true },
  { service: 'OS', label: 'Version (public)', method: 'GET', path: `${API}/os/v4/Version`, anonymous: true },
  { service: 'OS', label: 'LMT services', method: 'GET', path: `${API}/os/v4/Trace/GetBlocksServices` },
];

type Verdict = 'up' | 'forbidden' | 'down';

interface Outcome {
  verdict: Verdict;
  status: number | null;
  ms: number;
  detail?: string;
}

async function run(p: Probe): Promise<Outcome> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    await blocksFetch<unknown>(p.path, { method: p.method, body: p.body, noRetry: p.anonymous });
    return { verdict: 'up', status: 200, ms: ms() };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { verdict: 'forbidden', status: 401, ms: ms(), detail: 'Not authenticated for this service' };
    if (e instanceof BlocksError) {
      if (e.status === 403 || e.status === 429) return { verdict: 'forbidden', status: e.status, ms: ms(), detail: e.status === 403 ? 'Reachable, but your role lacks the permission' : 'Rate/quota limited' };
      // A 400 means the route exists and the service parsed the request — reachable.
      if (e.status === 400 || e.status === 405 || e.status === 406) return { verdict: e.status === 406 ? 'down' : 'up', status: e.status, ms: ms(), detail: e.status === 406 ? 'Origin not allowed for this tenant' : 'Reachable (request rejected)' };
      return { verdict: 'down', status: e.status, ms: ms(), detail: typeof e.body === 'string' ? e.body.slice(0, 160) : undefined };
    }
    return { verdict: 'down', status: null, ms: ms(), detail: e instanceof Error ? `${e.message} (network or CORS)` : String(e) };
  }
}

export function HealthPage() {
  const results = useQueries({
    queries: PROBES.map((p) => ({
      queryKey: ['health', p.path],
      queryFn: () => run(p),
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const fetching = results.some((r) => r.isFetching);
  const down = results.filter((r) => r.data?.verdict === 'down').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service health"
        description="One request per Blocks service through the gateway, as you. 403 = reachable but not permitted."
        actions={
          <Button variant="outline" size="sm" disabled={fetching} onClick={() => results.forEach((r) => void r.refetch())}>
            <RefreshCw className="h-4 w-4" /> Re-run
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        {fetching ? 'Probing…' : down ? `${down} probe(s) failing.` : 'All probed services answered.'} API: <code>{API || '(unset)'}</code>
      </p>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y text-sm">
            {PROBES.map((p, i) => {
              const r = results[i];
              const o = r.data;
              return (
                <li key={p.path} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5">
                    {r.isFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : o?.verdict === 'up' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : o?.verdict === 'forbidden' ? (
                      <CircleAlert className="h-4 w-4 text-amber-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                  </span>
                  <Badge tone="muted" className="w-24 justify-center">
                    {p.service}
                  </Badge>
                  <span className="w-44 shrink-0">{p.label}</span>
                  <code className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground lg:block">
                    {p.method} {p.path.replace(API, '')}
                  </code>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {o ? `${o.status ?? 'ERR'} · ${o.ms} ms` : ''}
                  </span>
                  {o?.detail && <span className="hidden max-w-xs truncate text-xs text-muted-foreground xl:inline" title={o.detail}>{o.detail}</span>}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

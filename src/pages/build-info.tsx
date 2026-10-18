import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { BLOCKS, configIssues } from '@/lib/env';
import { trackedFetch } from '@/lib/tracked-fetch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, ErrorNote, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { DetailList, JsonView, PageHeader } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

type BuildInfo = typeof __BUILD_INFO__;

/**
 * What is running, and is it what Release deployed?
 *
 * Three views of the same build:
 *   - `__BUILD_INFO__`  — stamped into *this* bundle when it was compiled.
 *   - `/version.json`   — the file the server is serving *now*. If it differs from the
 *                          bundle, a newer deploy has landed and this tab is stale.
 *   - `import.meta.env` — every VITE_* value the build saw. Release passes the repo's
 *                          secret set and build args in as environment, so a key you
 *                          synced with `blocks release secrets sync` (VITE_-prefixed)
 *                          shows up here — that is the end-to-end check that injection works.
 */
export function BuildInfoPage() {
  const bundle: BuildInfo = __BUILD_INFO__;
  const live = useQuery({
    queryKey: ['build', 'version.json'],
    queryFn: async () => {
      const res = await trackedFetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`/version.json answered ${res.status} — expected in dev mode, where it is not emitted.`);
      return (await res.json()) as BuildInfo;
    },
    retry: false,
  });

  const stale = live.data && live.data.builtAt !== bundle.builtAt;
  const env = Object.entries(import.meta.env as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const issues = configIssues();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Build & release"
        description="Which build is running, what the pipeline injected, and whether a newer deploy is live."
        endpoints={['GET /version.json', 'GET /healthz']}
      />

      {issues.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-amber-600">
              <AlertTriangle className="h-4 w-4" /> Configuration problems
            </p>
            {issues.map((i) => (
              <p key={i} className="text-muted-foreground">
                {i}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This bundle</CardTitle>
            <CardDescription>Compiled into the JavaScript you are running</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              rows={[
                ['Version', bundle.version],
                ['Mode', <Badge tone="muted">{bundle.mode}</Badge>],
                ['Built at', formatDate(bundle.builtAt)],
                ['Commit', <span className="font-mono text-xs">{bundle.commit || '—'}</span>],
                ['Branch', bundle.branch || '—'],
                ['Build id', bundle.buildId || '—'],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Live deployment</CardTitle>
              <CardDescription>What the server serves at /version.json right now</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => live.refetch()} disabled={live.isFetching}>
              <RefreshCw className="h-4 w-4" />
              Check
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {live.isPending ? (
              <Spinner />
            ) : live.isError ? (
              <ErrorNote error={live.error} />
            ) : (
              <>
                {stale ? (
                  <p className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4" /> A newer build is deployed — reload to pick it up.
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> This tab is running the deployed build.
                  </p>
                )}
                <DetailList
                  rows={[
                    ['Built at', formatDate(live.data.builtAt)],
                    ['Commit', <span className="font-mono text-xs">{live.data.commit || '—'}</span>],
                    ['Build id', live.data.buildId || '—'],
                  ]}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build-time environment</CardTitle>
          <CardDescription>
            Every <code>VITE_*</code> value the build saw. Anything here ships in the bundle — so a
            secret must never be VITE_-prefixed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {env.map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{k}</td>
                    <td className="break-all py-2 font-mono text-xs">{String(v) || <em>empty</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resolved Blocks config</CardTitle>
          <CardDescription>What src/lib/env.ts derived from the values above</CardDescription>
        </CardHeader>
        <CardContent>
          <JsonView value={BLOCKS} />
        </CardContent>
      </Card>
    </div>
  );
}

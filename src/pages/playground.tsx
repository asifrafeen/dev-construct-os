import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { BLOCKS } from '@/lib/env';
import { BlocksError, blocksFetch } from '@/lib/blocks-client';
import { PRESETS, type HttpMethod, type Preset } from '@/features/playground/presets';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, ErrorNote, Input } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea, parseJsonInput } from '@/components/ui/form';
import { JsonView, PageHeader } from '@/components/ui/layout';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface Outcome {
  status: number;
  ok: boolean;
  durationMs: number;
  body: unknown;
}

/**
 * Any request, against any Blocks service, as the signed-in user.
 *
 * It goes through `blocksFetch`, so it gets exactly what the app's own calls get:
 * `x-blocks-key`, the session cookie, and one refresh-and-retry on a 401. That makes it
 * the honest answer to "does this endpoint work for a project user?" — no console token,
 * no impersonation.
 */
export function PlaygroundPage() {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('/iam/v4/iam/me');
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState('');
  const [noRetry, setNoRetry] = useState(false);

  const run = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      const url = /^https?:\/\//i.test(path) ? path : `${BLOCKS.apiUrl}${path.startsWith('/') ? '' : '/'}${path}`;
      const parsedBody = method === 'GET' ? undefined : parseJsonInput(body, 'Body');
      const parsedHeaders = parseJsonInput<Record<string, string>>(headers, 'Headers');
      const t0 = performance.now();
      try {
        const res = await blocksFetch<unknown>(url, {
          method,
          body: parsedBody,
          headers: parsedHeaders,
          noRetry,
        });
        return { status: 200, ok: true, durationMs: Math.round(performance.now() - t0), body: res };
      } catch (e) {
        // A non-2xx is a result here, not a failure — the point is to see what came back.
        if (e instanceof BlocksError) {
          return { status: e.status, ok: false, durationMs: Math.round(performance.now() - t0), body: e.body };
        }
        throw e;
      }
    },
  });

  const load = (p: Preset) => {
    setMethod(p.method);
    setPath(p.path.replace(/<project key>/g, BLOCKS.projectKey));
    setBody(p.body === undefined ? '' : JSON.stringify(p.body, null, 2));
    run.reset();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="API playground"
        description={
          <>
            Send any request to <code>{BLOCKS.apiUrl || '(VITE_BLOCKS_API_URL unset)'}</code> with this session's
            cookie and <code>x-blocks-key</code>.
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Presets</CardTitle>
            <CardDescription>Click to load into the editor</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-4 overflow-y-auto">
            {Object.entries(PRESETS).map(([group, presets]) => (
              <div key={group}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
                <ul className="space-y-0.5">
                  {presets.map((p) => (
                    <li key={`${group}-${p.label}`}>
                      <button
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                        onClick={() => load(p)}
                        title={p.note ?? p.path}
                      >
                        <span className="w-10 shrink-0 font-mono text-[10px] text-muted-foreground">{p.method}</span>
                        <span className="truncate">{p.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run.mutate();
                }}
              >
                <Select className="w-28" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
                <Input
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/service/v4/Controller/Action?query=1"
                />
                <Button disabled={run.isPending || !path.trim()}>
                  <Send className="h-4 w-4" />
                  {run.isPending ? 'Sending…' : 'Send'}
                </Button>
              </form>

              {method !== 'GET' && (
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">JSON body</span>
                  <Textarea mono rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="{ }" />
                </label>
              )}
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Extra headers (JSON, optional)</span>
                <Textarea mono rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder='{ "x-custom": "value" }' />
              </label>
              <Checkbox
                label="Don't refresh-and-retry on 401"
                hint="See the raw 401 instead of letting the client renew the session first."
                checked={noRetry}
                onChange={setNoRetry}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Response</CardTitle>
              {run.data && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={run.data.ok ? 'success' : 'danger'}>{run.data.ok ? '2xx' : run.data.status}</Badge>
                  <span className="text-muted-foreground">{run.data.durationMs} ms</span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {run.isError ? (
                <ErrorNote error={run.error} />
              ) : run.data ? (
                <JsonView value={run.data.body ?? '(empty body)'} maxHeight="max-h-[60vh]" />
              ) : (
                <p className="text-sm text-muted-foreground">Send a request to see the response.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

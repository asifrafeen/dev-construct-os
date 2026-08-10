import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { gql } from '@/features/data/gateway';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/misc';

const SAMPLE = `query {
  getProducts(paging: { pageNo: 1, pageSize: 10 }) {
    totalCount
    items { ItemId Title Price }
  }
}`;

/**
 * A console against POST /data/v4/gateway.
 *
 * The generated operation names depend on the schemas configured for this project, so
 * rather than shipping a CRUD screen for a schema that may not exist, this lets you run
 * a query and confirm the wiring. Once a schema is live, build a typed screen with
 * `makeCrud` (see src/features/data/README.md).
 */
export function DataPage() {
  const [query, setQuery] = useState(SAMPLE);

  const run = useMutation({
    mutationFn: () => gql<Record<string, unknown>>(query),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data gateway</h1>
        <p className="text-sm text-muted-foreground">
          POST /data/v4/gateway — one endpoint for every schema's queries and mutations.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Query</CardTitle>
            <CardDescription>
              Operation names come from the schema's <code>querySchema</code> /{' '}
              <code>mutationSchemas</code> — don't hand-pluralize them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="h-64 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              <Play className="h-4 w-4" />
              {run.isPending ? 'Running…' : 'Run query'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response</CardTitle>
            <CardDescription>
              A “Field 'getX' does not exist” error means the schema isn't created or wasn't
              reloaded after editing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {run.isError ? (
              <ErrorNote error={run.error} />
            ) : run.data ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                {JSON.stringify(run.data, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">Run a query to see the result.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

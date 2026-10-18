import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, Plus, RefreshCw, Trash2, Upload, Wand2 } from 'lucide-react';
import { gql } from '@/features/data/gateway';
import {
  ACCESS_LEVEL,
  SCALARS,
  isBaseField,
  recordsApi,
  schemaApi,
  writableFields,
  type SchemaDefinition,
  type SchemaField,
} from '@/features/data/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal, Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, parseJsonInput } from '@/components/ui/form';
import { JsonView, PageHeader, Pager, Tabs } from '@/components/ui/layout';
import { cn } from '@/lib/utils';

type Tab = 'records' | 'console' | 'validations' | 'tools';

export function DataPage() {
  const [tab, setTab] = useState<Tab>('records');
  const [selected, setSelected] = useState<SchemaDefinition | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data gateway"
        description="Schemas from the project's Data service, records through the GraphQL gateway."
        endpoints={['GET /data/v4/schemas', 'POST /data/v4/gateway', 'GET /data/v4/data-validations', 'POST /data/v4/regex/generate-regex']}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'records', label: 'Records' },
          { value: 'console', label: 'GraphQL console' },
          { value: 'validations', label: 'Validations' },
          { value: 'tools', label: 'Tools' },
        ]}
      />
      {tab === 'records' && <RecordsTab selected={selected} onSelect={setSelected} />}
      {tab === 'console' && <ConsoleTab schema={selected} />}
      {tab === 'validations' && <ValidationsTab schema={selected} />}
      {tab === 'tools' && <ToolsTab />}
    </div>
  );
}

function useSchemas() {
  return useQuery({
    queryKey: ['data', 'schemas'],
    queryFn: () => schemaApi.list({ pageSize: 200 }),
    select: (r) => r.data?.items ?? [],
  });
}

function SchemaList({ selected, onSelect }: { selected: SchemaDefinition | null; onSelect: (s: SchemaDefinition) => void }) {
  const schemas = useSchemas();
  const [filter, setFilter] = useState('');
  const rows = (schemas.data ?? []).filter((s) => !filter || s.schemaName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card className="h-fit">
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center justify-between text-base">
          Schemas
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => schemas.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
        <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </CardHeader>
      <CardContent className="max-h-[65vh] overflow-y-auto">
        {schemas.isPending ? (
          <Spinner />
        ) : schemas.isError ? (
          <ErrorNote error={schemas.error} />
        ) : !rows.length ? (
          <EmptyState title="No schemas" description="Create one in Blocks OS → Data, then reload it." />
        ) : (
          <ul className="space-y-0.5">
            {rows.map((s) => (
              <li key={s.id}>
                <button
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                    selected?.id === s.id && 'bg-accent font-medium',
                  )}
                  onClick={() => onSelect(s)}
                >
                  <span className="truncate">{s.schemaName}</span>
                  {s.schemaType === 2 && <Badge tone="muted">Dto</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecordsTab({ selected, onSelect }: { selected: SchemaDefinition | null; onSelect: (s: SchemaDefinition) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
      <SchemaList selected={selected} onSelect={onSelect} />
      {!selected ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState title="Pick a schema" description="Its records load here, with create, edit, delete and bulk operations." />
          </CardContent>
        </Card>
      ) : selected.schemaType === 2 ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground">
              <strong>{selected.schemaName}</strong> is a Dto — an embedded object type with no operations of its own.
            </p>
            <JsonView value={selected} />
          </CardContent>
        </Card>
      ) : (
        <RecordsPanel key={selected.id} schema={selected} />
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

function RecordsPanel({ schema }: { schema: SchemaDefinition }) {
  const api = useMemo(() => recordsApi(schema), [schema]);
  const qc = useQueryClient();
  const fields = schema.fields ?? [];
  const hasItemId = fields.some((f) => f.name === 'ItemId');
  const columns = fields.filter((f) => SCALARS.has(f.type) && !f.isArray).slice(0, 8);

  const [page, setPage] = useState(1);
  const [whereText, setWhereText] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('DESC');
  const [applied, setApplied] = useState<{ where?: unknown }>({});
  const [whereError, setWhereError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | 'new' | null>(null);
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const [bulk, setBulk] = useState<'insert' | 'update' | 'delete' | null>(null);

  const key = ['data', 'records', schema.schemaName];
  const list = useQuery({
    queryKey: [...key, page, applied, sortField, sortDir],
    queryFn: () =>
      api.list({
        where: applied.where,
        paging: { pageNo: page, pageSize: PAGE_SIZE },
        order: sortField ? [{ field: sortField, direction: sortDir }] : undefined,
      }),
    retry: false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const remove = useMutation({
    mutationFn: ({ id, hard }: { id: string; hard: boolean }) => api.remove({ ItemId: { eq: id } }, hard),
    onSuccess: invalidate,
  });

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{schema.schemaName}</CardTitle>
            <CardDescription>
              collection <code>{schema.collectionName}</code> · query <code>{api.listOp}</code>
            </CardDescription>
            <div className="mt-2 flex flex-wrap gap-1">
              {(['read', 'write', 'edit', 'delete'] as const).map((op) => (
                <Badge key={op} tone="muted">
                  {op}: {ACCESS_LEVEL[(schema[`${op}AccessLevel`] as number) ?? 0] ?? '?'}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulk('insert')}>
              <Upload className="h-4 w-4" /> Insert many
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulk('update')}>
              Update many
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulk('delete')}>
              Delete many
            </Button>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Textarea
            mono
            rows={2}
            placeholder={`where (${schema.schemaName}FilterInput), e.g. { "${columns[0]?.name ?? 'Name'}": { "contains": "a" } }`}
            value={whereText}
            onChange={(e) => setWhereText(e.target.value)}
          />
          <div className="flex flex-wrap items-start gap-2">
            <Select className="w-40" value={sortField} onChange={(e) => setSortField(e.target.value)}>
              <option value="">No sort</option>
              {fields
                .filter((f) => SCALARS.has(f.type))
                .map((f) => (
                  <option key={f.name}>{f.name}</option>
                ))}
            </Select>
            <Select className="w-24" value={sortDir} onChange={(e) => setSortDir(e.target.value as 'ASC' | 'DESC')}>
              <option>DESC</option>
              <option>ASC</option>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  setApplied({ where: parseJsonInput(whereText, 'where') });
                  setWhereError(null);
                  setPage(1);
                } catch (e) {
                  setWhereError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Apply
            </Button>
          </div>
        </div>
        {whereError && <ErrorNote error={whereError} />}
      </CardHeader>

      <CardContent>
        {remove.isError && <ErrorNote error={remove.error} />}
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !list.data?.items?.length ? (
          <EmptyState title="No records" description="Create one, or loosen the filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.name} className="whitespace-nowrap px-2 py-2 font-medium">
                      {c.name}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row, i) => {
                  const id = row.ItemId as string | undefined;
                  return (
                    <tr key={id ?? i} className="cursor-pointer border-b last:border-0 hover:bg-accent/40" onClick={() => setViewing(row)}>
                      {columns.map((c) => (
                        <td key={c.name} className="max-w-[16rem] truncate px-2 py-2">
                          {formatCell(row[c.name])}
                        </td>
                      ))}
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={!hasItemId}
                            title={hasItemId ? 'Edit' : 'Schema has no ItemId field'}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={!id || remove.isPending}
                            title="Soft delete (shift-click: hard delete)"
                            onClick={(e) => id && remove.mutate({ id, hard: e.shiftKey })}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pager page={page} pageCount={list.data.totalPages} total={list.data.totalCount} onChange={setPage} />}
      </CardContent>

      {editing && (
        <RecordModal
          schema={schema}
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      )}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`${schema.schemaName} record`} className="max-w-2xl">
          <JsonView value={viewing} />
        </Modal>
      )}
      {bulk && <BulkModal schema={schema} mode={bulk} onClose={() => setBulk(null)} onDone={() => void invalidate()} />}
    </Card>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Whether a field gets a plain control, or has to be edited as JSON. */
const isComplex = (f: SchemaField) => f.isArray || !SCALARS.has(f.type) || f.type === 'GeoJson';

function toInput(f: SchemaField, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (isComplex(f)) return JSON.stringify(v, null, 2);
  if (f.type === 'DateTime' && typeof v === 'string') return v.slice(0, 16);
  return String(v);
}

function fromInput(f: SchemaField, raw: string): unknown {
  if (raw === '') return undefined;
  if (isComplex(f)) return parseJsonInput(raw, f.name);
  switch (f.type) {
    case 'Int':
      return parseInt(raw, 10);
    case 'Float':
      return parseFloat(raw);
    case 'Boolean':
      return raw === 'true';
    case 'DateTime':
      return new Date(raw).toISOString();
    default:
      return raw;
  }
}

function RecordModal({
  schema,
  record,
  onClose,
  onSaved,
}: {
  schema: SchemaDefinition;
  record: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useMemo(() => recordsApi(schema), [schema]);
  const mode = record ? 'update' : 'insert';
  const fields = writableFields(schema, mode);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, toInput(f, record?.[f.name])])),
  );
  const [asJson, setAsJson] = useState(false);
  const [json, setJson] = useState(() =>
    JSON.stringify(record ? Object.fromEntries(fields.map((f) => [f.name, record[f.name]])) : {}, null, 2),
  );

  const save = useMutation({
    mutationFn: async () => {
      let input: Record<string, unknown>;
      if (asJson) input = parseJsonInput<Record<string, unknown>>(json, 'Record') ?? {};
      else {
        input = {};
        for (const f of fields) {
          const v = fromInput(f, values[f.name] ?? '');
          if (v !== undefined) input[f.name] = v;
        }
      }
      const res = record ? await api.update({ ItemId: { eq: record.ItemId } }, input) : await api.insert(input);
      if (res && res.acknowledged === false) throw new Error(res.message || 'The gateway did not acknowledge the write.');
      return res;
    },
    onSuccess: onSaved,
  });

  const required = (f: SchemaField) => f.requiredOn === 'Both' || f.requiredOn === (mode === 'insert' ? 'Insert' : 'Update');

  return (
    <Modal
      open
      onClose={onClose}
      title={record ? `Edit ${schema.schemaName}` : `New ${schema.schemaName}`}
      description={record ? <code>{String(record.ItemId)}</code> : undefined}
      className="max-w-2xl"
      footer={
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <Checkbox label="Edit as raw JSON" checked={asJson} onChange={setAsJson} />
      {asJson ? (
        <Textarea mono rows={14} value={json} onChange={(e) => setJson(e.target.value)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={cn(isComplex(f) && 'sm:col-span-2')}>
              <Field
                label={`${f.name}${required(f) ? ' *' : ''}`}
                hint={[f.isArray ? `${f.type}[]` : f.type, isBaseField(f) ? 'system' : '', f.description].filter(Boolean).join(' · ')}
              >
                {f.type === 'Enum' && !f.isArray ? (
                  <Select value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    <option value="">—</option>
                    {(f.enumValues ?? []).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                ) : f.type === 'Boolean' && !f.isArray ? (
                  <Select value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : isComplex(f) ? (
                  <Textarea mono rows={3} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                ) : (
                  <Input
                    type={f.type === 'Int' || f.type === 'Float' ? 'number' : f.type === 'DateTime' ? 'datetime-local' : 'text'}
                    step={f.type === 'Float' ? 'any' : undefined}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                )}
              </Field>
            </div>
          ))}
        </div>
      )}
      {save.isError && <ErrorNote error={save.error} />}
    </Modal>
  );
}

function BulkModal({
  schema,
  mode,
  onClose,
  onDone,
}: {
  schema: SchemaDefinition;
  mode: 'insert' | 'update' | 'delete';
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useMemo(() => recordsApi(schema), [schema]);
  const [items, setItems] = useState('[\n  {}\n]');
  const [where, setWhere] = useState('{}');
  const [input, setInput] = useState('{}');
  const [hard, setHard] = useState(false);
  const run = useMutation({
    mutationFn: () => {
      if (mode === 'insert') return api.insertMany(parseJsonInput<Record<string, unknown>[]>(items, 'Items') ?? []);
      const w = parseJsonInput(where, 'where');
      if (mode === 'update') return api.update(w, parseJsonInput<Record<string, unknown>>(input, 'input') ?? {}, true);
      return api.remove(w, hard, true);
    },
    onSuccess: onDone,
  });
  const op = { insert: `insertMany${schema.schemaName}`, update: `updateMany${schema.schemaName}`, delete: `deleteMany${schema.schemaName}` }[mode];

  return (
    <Modal
      open
      onClose={onClose}
      title={op}
      className="max-w-2xl"
      footer={
        <Button variant={mode === 'delete' ? 'destructive' : 'default'} disabled={run.isPending} onClick={() => run.mutate()}>
          Run
        </Button>
      }
    >
      {mode === 'insert' ? (
        <Field label="Items (JSON array)">
          <Textarea mono rows={10} value={items} onChange={(e) => setItems(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label={`where (${schema.schemaName}FilterInput)`} hint="{} matches every record.">
            <Textarea mono rows={4} value={where} onChange={(e) => setWhere(e.target.value)} />
          </Field>
          {mode === 'update' ? (
            <Field label="input (fields to set)">
              <Textarea mono rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
            </Field>
          ) : (
            <Checkbox label="Hard delete" hint="Skip the deleted-records copy." checked={hard} onChange={setHard} />
          )}
        </>
      )}
      {run.isError && <ErrorNote error={run.error} />}
      {run.data && <JsonView value={run.data} maxHeight="max-h-40" />}
    </Modal>
  );
}

function ConsoleTab({ schema }: { schema: SchemaDefinition | null }) {
  const sample = schema
    ? `query {\n  ${recordsApi(schema).listOp}(paging: { pageNo: 1, pageSize: 10 }) {\n    totalCount\n    items { ${recordsApi(schema).selection} }\n  }\n}`
    : `query {\n  getProducts(paging: { pageNo: 1, pageSize: 10 }) {\n    totalCount\n    items { ItemId }\n  }\n}`;
  const [query, setQuery] = useState(sample);
  const [variables, setVariables] = useState('');
  const run = useMutation({
    mutationFn: () => gql<Record<string, unknown>>(query, parseJsonInput<Record<string, unknown>>(variables, 'Variables') ?? {}),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Query</CardTitle>
          <CardDescription>
            Operation names come from the schema — <code>get{'{querySchema}'}</code>, <code>insert/update/delete{'{Schema}'}</code>, plus the{' '}
            <code>…Many</code> variants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea mono rows={14} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Textarea mono rows={3} placeholder="Variables (JSON, optional)" value={variables} onChange={(e) => setVariables(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              <Play className="h-4 w-4" />
              {run.isPending ? 'Running…' : 'Run'}
            </Button>
            {schema && (
              <Button variant="outline" onClick={() => setQuery(sample)}>
                Sample for {schema.schemaName}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response</CardTitle>
          <CardDescription>“Field 'getX' does not exist” means the schema isn't created or wasn't reloaded.</CardDescription>
        </CardHeader>
        <CardContent>
          {run.isError ? (
            <ErrorNote error={run.error} />
          ) : run.data ? (
            <JsonView value={run.data} maxHeight="max-h-[60vh]" />
          ) : (
            <p className="text-sm text-muted-foreground">Run a query to see the result.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValidationsTab({ schema }: { schema: SchemaDefinition | null }) {
  const all = useQuery({
    queryKey: ['data', 'validations', schema?.id ?? 'all'],
    queryFn: () => (schema ? schemaApi.validationsBySchema(schema.id) : schemaApi.validations()),
    retry: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Validation rules {schema ? `— ${schema.schemaName}` : '(all schemas)'}</CardTitle>
        <CardDescription>The rules the gateway enforces on writes. Pick a schema on the Records tab to narrow this.</CardDescription>
      </CardHeader>
      <CardContent>{all.isPending ? <Spinner /> : all.isError ? <ErrorNote error={all.error} /> : <JsonView value={all.data} maxHeight="max-h-[60vh]" />}</CardContent>
    </Card>
  );
}

function ToolsTab() {
  const [description, setDescription] = useState('A Bangladeshi mobile number starting with 01');
  const [sample, setSample] = useState('');
  const regex = useMutation({ mutationFn: () => schemaApi.generateRegex(description) });
  const mock = useMutation({ mutationFn: () => schemaApi.mockData() });
  const info = useMutation({ mutationFn: () => schemaApi.info() });

  let matches: boolean | null = null;
  try {
    matches = regex.data?.pattern && sample ? new RegExp(regex.data.pattern).test(sample) : null;
  } catch {
    matches = null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" /> Regex assistant
          </CardTitle>
          <CardDescription>Describe a format; Data generates a validation pattern.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button disabled={!description.trim() || regex.isPending} onClick={() => regex.mutate()}>
            {regex.isPending ? 'Generating…' : 'Generate'}
          </Button>
          {regex.isError && <ErrorNote error={regex.error} />}
          {regex.data && (
            <>
              <JsonView value={regex.data} maxHeight="max-h-32" />
              <Input placeholder="Try a value against the pattern" value={sample} onChange={(e) => setSample(e.target.value)} />
              {matches !== null && <Badge tone={matches ? 'success' : 'danger'}>{matches ? 'matches' : 'no match'}</Badge>}
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schema info & mock data</CardTitle>
          <CardDescription>GET /schemas/info (collections overview) and GET /mock-data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" disabled={info.isPending} onClick={() => info.mutate()}>
              Schema info
            </Button>
            <Button variant="outline" disabled={mock.isPending} onClick={() => mock.mutate()}>
              Mock data
            </Button>
          </div>
          {info.isError && <ErrorNote error={info.error} />}
          {info.data && <JsonView value={info.data} maxHeight="max-h-64" />}
          {mock.isError && <ErrorNote error={mock.error} />}
          {mock.data !== undefined && <JsonView value={mock.data} maxHeight="max-h-64" />}
        </CardContent>
      </Card>
    </div>
  );
}

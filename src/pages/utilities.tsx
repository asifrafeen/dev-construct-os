import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import {
  docJobs,
  geolocation,
  JOB_STATUS,
  MAGIC_LINK_TYPE,
  magicLinks,
  payments,
  pdf,
  sequences,
  settle,
  sms,
  subscriptions,
  type DocJob,
} from '@/features/utilities/api';
import { files } from '@/features/files/api';
import { useUploadFile } from '@/features/files/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/modal';
import { Checkbox, Select, Textarea, parseJsonInput, splitList } from '@/components/ui/form';
import { CopyButton, JsonView, PageHeader, Tabs } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

type Tab = 'links' | 'sequence' | 'documents' | 'sms' | 'payments' | 'subscriptions';

export function UtilitiesPage() {
  const [tab, setTab] = useState<Tab>('links');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilities"
        description="The Blocks Utilities service, end to end — every call here runs as the signed-in user."
        endpoints={['/utilities/v4/MagicLink/*', '/utilities/v4/Sequence/*', '/utilities/v4/PdfGenerator/*', '/utilities/v4/Sms/*', '/utilities/v4/payments', '/utilities/v4/entitlements']}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'links', label: 'Magic links' },
          { value: 'sequence', label: 'Sequences & geolocation' },
          { value: 'documents', label: 'PDF & documents' },
          { value: 'sms', label: 'SMS' },
          { value: 'payments', label: 'Payments' },
          { value: 'subscriptions', label: 'Subscriptions' },
        ]}
      />
      {tab === 'links' && <LinksTab />}
      {tab === 'sequence' && <SequenceTab />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'subscriptions' && <SubscriptionsTab />}
    </div>
  );
}

/** Error-or-result for any mutation. */
function Out({ m }: { m: UseMutationResult<unknown, Error, unknown, unknown> | UseMutationResult<unknown, Error, void, unknown> }) {
  if (m.isError) return <ErrorNote error={m.error} />;
  if (m.data !== undefined) return <JsonView value={m.data} maxHeight="max-h-64" />;
  return null;
}

function LinksTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['utilities', 'links'], queryFn: () => magicLinks.list({ pageSize: 50 }) });
  const [type, setType] = useState<number>(MAGIC_LINK_TYPE.Redirect);
  const [name, setName] = useState('Construct OS test link');
  const [uri, setUri] = useState(`${window.location.origin}/`);
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('POST');
  const [payload, setPayload] = useState('');
  const [usageLimit, setUsageLimit] = useState('0');
  const [expiryMinutes, setExpiryMinutes] = useState('60');
  const [persistent, setPersistent] = useState(false);
  const [userCanLogin, setUserCanLogin] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['utilities', 'links'] });
  const create = useMutation({
    mutationFn: () =>
      magicLinks.create({
        type,
        name,
        uri: uri.trim(),
        ...(type === MAGIC_LINK_TYPE.Action ? { requestMethod: method, requestPayload: payload || undefined } : { redirectUrl: uri.trim() }),
        usageLimit: Number(usageLimit) || 0,
        expiryLifeSpan: (Number(expiryMinutes) || 0) * 60_000,
        userCanLogin,
        persistent,
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => magicLinks.remove([id]), onSuccess: refresh });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Create a magic link
          </CardTitle>
          <CardDescription>A short URL that redirects, or performs a request on the server's behalf, with usage and expiry limits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={type} onChange={(e) => setType(Number(e.target.value))}>
            <option value={MAGIC_LINK_TYPE.Redirect}>Redirect (1)</option>
            <option value={MAGIC_LINK_TYPE.Action}>Action (0)</option>
          </Select>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={type === MAGIC_LINK_TYPE.Redirect ? 'Target URL' : 'Request URL (absolute)'}>
            <Input value={uri} onChange={(e) => setUri(e.target.value)} />
          </Field>
          {type === MAGIC_LINK_TYPE.Action && (
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <Input placeholder="Request payload (string)" value={payload} onChange={(e) => setPayload(e.target.value)} />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Usage limit" hint="0 = unlimited">
              <Input type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
            </Field>
            <Field label="Expires after (minutes)" hint="0 = never">
              <Input type="number" value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)} />
            </Field>
          </div>
          <Checkbox label="Persistent" checked={persistent} onChange={setPersistent} />
          <Checkbox label="User can log in" checked={userCanLogin} onChange={setUserCanLogin} />
          <Button disabled={!uri.trim() || create.isPending} onClick={() => create.mutate()}>
            Create link
          </Button>
          {create.data?.shortUri && (
            <p className="flex items-center gap-1 text-sm">
              <a className="text-primary underline" href={create.data.shortUri} target="_blank" rel="noreferrer">
                {create.data.shortUri}
              </a>
              <CopyButton text={create.data.shortUri} />
            </p>
          )}
          <Out m={create} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links</CardTitle>
          <CardDescription>GET /MagicLink/GetLinks — status, usage and expiry per link.</CardDescription>
        </CardHeader>
        <CardContent>
          {remove.isError && <ErrorNote error={remove.error} />}
          {list.isPending ? (
            <Spinner />
          ) : list.isError ? (
            <ErrorNote error={list.error} />
          ) : !list.data?.data?.length ? (
            <EmptyState title="No links yet" />
          ) : (
            <ul className="divide-y text-sm">
              {list.data.data.map((l) => (
                <li key={l.itemId} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {l.name ?? l.itemId} <Badge tone={l.isExpired ? 'muted' : 'success'}>{String(l.status ?? (l.isExpired ? 'expired' : 'active'))}</Badge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {l.usageCount ?? 0}/{l.usageLimit || '∞'} uses · expires {formatDate(l.expiryDate)} · {l.uri}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Invoke through the gateway">
                      <a href={l.shortUri ?? magicLinks.invokeUrl(l.itemId)} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={remove.isPending} onClick={() => remove.mutate(l.itemId)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SequenceTab() {
  const [context, setContext] = useState('construct-os-invoice');
  const [hex, setHex] = useState(false);
  const [resetTo, setResetTo] = useState('0');
  const next = useMutation({ mutationFn: () => sequences.next(context.trim(), hex) });
  const reset = useMutation({ mutationFn: () => sequences.reset(context.trim(), Number(resetTo)) });
  const [ips, setIps] = useState('8.8.8.8, 1.1.1.1');
  const locate = useMutation({ mutationFn: () => geolocation.locate(splitList(ips)) });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sequences</CardTitle>
          <CardDescription>Atomic counters per context — e.g. invoice numbers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={context} onChange={(e) => setContext(e.target.value)} placeholder="context" />
          <Checkbox label="Hex (NextHex)" checked={hex} onChange={setHex} />
          <Button disabled={!context.trim() || next.isPending} onClick={() => next.mutate()}>
            Next number
          </Button>
          {next.data && <p className="text-3xl font-semibold tabular-nums">{String(next.data.currentNumber)}</p>}
          {next.isError && <ErrorNote error={next.error} />}
          <div className="flex gap-2 border-t pt-3">
            <Input type="number" className="w-32" value={resetTo} onChange={(e) => setResetTo(e.target.value)} />
            <Button variant="outline" disabled={reset.isPending} onClick={() => reset.mutate()}>
              Reset to value
            </Button>
          </div>
          <Out m={reset} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">IP geolocation</CardTitle>
          <CardDescription>Up to 10 addresses. The first uncached lookup can take a few seconds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={ips} onChange={(e) => setIps(e.target.value)} />
          <Button disabled={!splitList(ips).length || locate.isPending} onClick={() => locate.mutate()}>
            {locate.isPending ? 'Locating…' : 'Locate'}
          </Button>
          {locate.isError && <ErrorNote error={locate.error} />}
          {locate.data?.data && (
            <ul className="divide-y text-sm">
              {locate.data.data.map((r, i) => (
                <li key={i} className="flex items-center gap-2 py-2">
                  {r.countryFlagSvgUrl && <img src={r.countryFlagSvgUrl} alt="" className="h-4 w-6 rounded-sm object-cover" />}
                  <span>
                    <code>{r.startIp}</code> → {[r.city, r.region, r.countryName].filter(Boolean).join(', ')} · {r.ispName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const SAMPLE_HTML = `<html><body style="font-family: sans-serif">
  <h1>Construct OS test PDF</h1>
  <p>Generated through Blocks Utilities at ${new Date().toISOString()}.</p>
</body></html>`;

function DocumentsTab() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [fileName, setFileName] = useState('construct-os-test.pdf');
  const [pages, setPages] = useState(true);
  const make = useMutation({ mutationFn: () => pdf.fromHtml({ htmlContent: html, outputFileName: fileName, isPageNumberEnabled: pages, isTotalPageCountEnabled: pages }) });
  const open = useMutation({ mutationFn: (fileId: string) => files.get(fileId), onSuccess: (r) => r.url && window.open(r.url, '_blank', 'noopener') });

  const upload = useUploadFile();
  const [job, setJob] = useState<DocJob>('document-conversions');
  const [fileIds, setFileIds] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const start = useMutation({ mutationFn: () => settle(docJobs.start(job, splitList(fileIds), job === 'pdf-ingestions' ? { dryRun } : {})) });
  const status = useMutation({ mutationFn: () => settle(docJobs.status(job, splitList(fileIds))) });
  const results = ((status.data?.body as { data?: { results?: Record<string, unknown>[] } } | undefined)?.data?.results ?? []) as Record<string, unknown>[];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">HTML → PDF</CardTitle>
          <CardDescription>POST /PdfGenerator/CreateSinglePdfFromHtml — synchronous; the PDF lands in Storage.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea mono rows={8} value={html} onChange={(e) => setHtml(e.target.value)} />
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} />
          <Checkbox label="Page numbers" checked={pages} onChange={setPages} />
          <div className="flex gap-2">
            <Button disabled={make.isPending} onClick={() => make.mutate()}>
              {make.isPending ? 'Rendering…' : 'Generate PDF'}
            </Button>
            {make.data?.fileId && (
              <Button variant="outline" disabled={open.isPending} onClick={() => open.mutate(make.data!.fileId!)}>
                Open PDF
              </Button>
            )}
          </div>
          <Out m={make} />
          {open.isError && <ErrorNote error={open.error} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Async document jobs</CardTitle>
          <CardDescription>Queue a job over Storage file ids, then poll its status. Conversion replaces the source file with a PDF.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={job} onChange={(e) => setJob(e.target.value as DocJob)}>
            <option value="document-conversions">document-conversions (doc/docx/rtf/odt → PDF)</option>
            <option value="pdf-ingestions">pdf-ingestions (PDF/A, readability, signatures)</option>
            <option value="pdf-signature-validations">pdf-signature-validations</option>
          </Select>
          <div className="flex items-center gap-2">
            <Input placeholder="file ids, comma separated (max 50)" value={fileIds} onChange={(e) => setFileIds(e.target.value)} />
            <label className="inline-flex shrink-0 cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-accent">
              {upload.isPending ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    upload.mutate(f, {
                      onSuccess: (r) => {
                        const id = r.fileId ?? r.itemId;
                        if (id) setFileIds((prev) => [...splitList(prev), String(id)].join(', '));
                      },
                    });
                }}
              />
            </label>
          </div>
          {upload.isError && <ErrorNote error={upload.error} />}
          {job === 'pdf-ingestions' && <Checkbox label="Dry run" checked={dryRun} onChange={setDryRun} />}
          <div className="flex gap-2">
            <Button disabled={!splitList(fileIds).length || start.isPending} onClick={() => start.mutate()}>
              Start job
            </Button>
            <Button variant="outline" disabled={!splitList(fileIds).length || status.isPending} onClick={() => status.mutate()}>
              Check status
            </Button>
          </div>
          {start.data && (
            <>
              <Badge tone={start.data.ok ? 'success' : 'danger'}>{start.data.ok ? 'accepted' : start.data.status}</Badge>
              <JsonView value={start.data.body} maxHeight="max-h-40" />
            </>
          )}
          {start.isError && <ErrorNote error={start.error} />}
          {results.length > 0 && (
            <ul className="divide-y text-sm">
              {results.map((r, i) => (
                <li key={i} className="py-2">
                  <code className="text-xs">{String(r.fileId)}</code>{' '}
                  <Badge tone={r.status === 2 ? 'success' : r.status === 3 ? 'danger' : 'default'}>
                    {typeof r.status === 'number' ? JOB_STATUS[r.status] : String(r.status ?? '—')}
                  </Badge>
                  {typeof r.downloadUrl === 'string' && (
                    <a className="ml-2 text-xs text-primary underline" href={r.downloadUrl} target="_blank" rel="noreferrer">
                      download
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {status.data && <JsonView value={status.data.body} maxHeight="max-h-48" />}
          {status.isError && <ErrorNote error={status.error} />}
        </CardContent>
      </Card>
    </div>
  );
}

function SmsTab() {
  const [numbers, setNumbers] = useState('');
  const [text, setText] = useState('Hello from Construct OS');
  const [template, setTemplate] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [context, setContext] = useState('{ "name": "Test" }');
  const send = useMutation({ mutationFn: () => sms.send(splitList(numbers), text) });
  const sendTpl = useMutation({ mutationFn: () => sms.sendByTemplate(splitList(numbers), template.trim(), language, parseJsonInput<Record<string, string>>(context, 'Data') ?? {}) });
  const templates = useQuery({ queryKey: ['utilities', 'sms-templates'], queryFn: sms.templates, retry: false });
  const provider = useQuery({ queryKey: ['utilities', 'sms-provider'], queryFn: sms.provider, retry: false });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send SMS</CardTitle>
          <CardDescription>Numbers in international format, e.g. +8801XXXXXXXXX.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="+8801…, +4479…" value={numbers} onChange={(e) => setNumbers(e.target.value)} />
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={!splitList(numbers).length || !text.trim() || send.isPending} onClick={() => send.mutate()}>
            Send text
          </Button>
          <Out m={send} />
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">…or by template</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Template name" value={template} onChange={(e) => setTemplate(e.target.value)} />
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <Textarea mono rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
            <Button variant="outline" disabled={!splitList(numbers).length || !template.trim() || sendTpl.isPending} onClick={() => sendTpl.mutate()}>
              Send template
            </Button>
            <Out m={sendTpl} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates & provider</CardTitle>
          <CardDescription>GET /Sms/GetTemplates · GET /Sms/GetProviderConfiguration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.isError ? <ErrorNote error={templates.error} /> : <JsonView value={templates.data} maxHeight="max-h-56" />}
          {provider.isError ? <ErrorNote error={provider.error} /> : <JsonView value={provider.data} maxHeight="max-h-56" />}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentsTab() {
  const [provider, setProvider] = useState('STRIPE');
  const [amount, setAmount] = useState('10');
  const [currency, setCurrency] = useState('EUR');
  const [orderId, setOrderId] = useState(() => `CO-${Date.now()}`);
  const [lookupId, setLookupId] = useState(() => new URLSearchParams(window.location.search).get('paymentDetailId') ?? '');
  const create = useMutation({
    mutationFn: () =>
      payments.create(
        { providerName: provider, amount: Number(amount), currencyCode: currency.toUpperCase(), orderId, description: 'Construct OS test payment', productName: 'Test' },
        orderId,
      ),
  });
  const lookup = useMutation({ mutationFn: () => payments.get(lookupId.trim()) });
  const list = useQuery({ queryKey: ['utilities', 'payments'], queryFn: () => payments.list(), retry: false });
  const methods = useQuery({ queryKey: ['utilities', 'payment-methods'], queryFn: payments.paymentMethods, retry: false });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hosted checkout</CardTitle>
          <CardDescription>
            Create a payment, then go to the provider's page. It returns to the provider's configured result URL with{' '}
            <code>?paymentDetailId=</code> — set that URL to this page to confirm the result here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Provider">
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </Field>
            <Field label="Order id">
              <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} />
            </Field>
            <Field label="Amount">
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Currency">
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              Create payment
            </Button>
            {create.data?.data?.redirectUrl && (
              <Button variant="outline" asChild>
                <a href={create.data.data.redirectUrl}>Go to checkout</a>
              </Button>
            )}
          </div>
          <Out m={create} />
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Confirm a payment</p>
            <div className="flex gap-2">
              <Input placeholder="paymentDetailId" value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
              <Button variant="outline" disabled={!lookupId.trim() || lookup.isPending} onClick={() => lookup.mutate()}>
                Look up
              </Button>
            </div>
            <Out m={lookup} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments & saved methods</CardTitle>
          <CardDescription>Needs blocks-utilities::payment::read / payment-method::read.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.isPending ? <Spinner /> : list.isError ? <ErrorNote error={list.error} /> : <JsonView value={list.data} maxHeight="max-h-64" />}
          {methods.isError ? <ErrorNote error={methods.error} /> : <JsonView value={methods.data} maxHeight="max-h-40" />}
        </CardContent>
      </Card>
    </div>
  );
}

function SubscriptionsTab() {
  const ent = useQuery({ queryKey: ['utilities', 'entitlements'], queryFn: subscriptions.entitlements, retry: false });
  const mine = useQuery({ queryKey: ['utilities', 'subs-mine'], queryFn: subscriptions.mine, retry: false });
  const usage = useQuery({ queryKey: ['utilities', 'usage-mine'], queryFn: subscriptions.usageMine, retry: false });
  const plans = useQuery({ queryKey: ['utilities', 'plans'], queryFn: subscriptions.plans, retry: false });
  const [key, setKey] = useState('');
  const check = useMutation({ mutationFn: () => subscriptions.entitlement(key.trim()) });
  const [meter, setMeter] = useState('');
  const [qty, setQty] = useState('1');
  const record = useMutation({ mutationFn: () => subscriptions.recordUsage(meter.trim(), Number(qty)) });

  const panel = (title: string, q: { isPending: boolean; isError: boolean; error: unknown; data?: unknown }) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : <JsonView value={q.data} maxHeight="max-h-64" />}</CardContent>
    </Card>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {panel('Entitlements (GET /entitlements)', ent)}
      {panel('My subscription (GET /subscriptions/mine)', mine)}
      {panel('My usage (GET /subscription-usage/mine)', usage)}
      {panel('Active plans (GET /subscription-plans)', plans)}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check one entitlement</CardTitle>
          <CardDescription>The feature-gate call an app makes before showing a paid feature.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="entitlement key" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button variant="outline" disabled={!key.trim() || check.isPending} onClick={() => check.mutate()}>
              Check
            </Button>
          </div>
          <Out m={check} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record metered usage</CardTitle>
          <CardDescription>POST /subscription-usage (needs usage::manage).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="meter key" value={meter} onChange={(e) => setMeter(e.target.value)} />
            <Input type="number" className="w-24" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Button variant="outline" disabled={!meter.trim() || record.isPending} onClick={() => record.mutate()}>
              Record
            </Button>
          </div>
          <Out m={record} />
        </CardContent>
      </Card>
    </div>
  );
}

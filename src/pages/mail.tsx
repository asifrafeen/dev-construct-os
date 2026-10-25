import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Paperclip, Send } from 'lucide-react';
import { useMe } from '@/features/users/hooks';
import { useI18n } from '@/features/localization/i18n';
import { mail, type MailboxMail, type SendMailInput } from '@/features/mail/api';
import { useUploadFile } from '@/features/files/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Textarea, parseJsonInput, splitList } from '@/components/ui/form';
import { Field } from '@/components/ui/modal';
import { JsonView, PageHeader, Pager, Tabs } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

type Tab = 'compose' | 'mailbox' | 'templates';

export function MailPage() {
  const [tab, setTab] = useState<Tab>('compose');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mail"
        description="Send templated email through the project's mail configuration, and check what was delivered."
        endpoints={['POST /logic/v4/Mail/Send', 'POST /logic/v4/Mail/SendToAny', 'GET /logic/v4/Mail/GetMailBoxMails', 'GET /logic/v4/Mail/Gets']}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'compose', label: 'Compose' },
          { value: 'mailbox', label: 'Mailbox' },
          { value: 'templates', label: 'Templates & servers' },
        ]}
      />
      {tab === 'compose' && <ComposeTab />}
      {tab === 'mailbox' && <MailboxTab />}
      {tab === 'templates' && <TemplatesTab />}
    </div>
  );
}

function MailboxTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [inbound, setInbound] = useState(false);
  const [open, setOpen] = useState<MailboxMail | null>(null);
  const pageSize = 20;
  const list = useQuery({
    queryKey: ['mail', 'mailbox', page, search, inbound],
    queryFn: () => mail.mailbox({ pageNumber: page, pageSize, searchText: search.trim() || undefined, isInbound: inbound }),
    retry: false,
  });
  const rows = Array.isArray(list.data) ? list.data : (list.data?.data ?? []);
  const total = Array.isArray(list.data) ? rows.length : (list.data?.totalCount ?? rows.length);
  const detail = useQuery({
    queryKey: ['mail', 'mailbox', 'one', open?.messageId ?? open?.itemId],
    queryFn: () => mail.mailboxMail(String(open?.messageId ?? open?.itemId)),
    enabled: !!open,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
        <Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Inbound only" checked={inbound} onChange={setInbound} />
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !rows.length ? (
          <EmptyState title="No mail" description="Send one from Compose — it shows up here with its delivery status." />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((m, i) => (
              <li key={String(m.itemId ?? m.messageId ?? i)}>
                <button className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-accent/40" onClick={() => setOpen(m)}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.subject ?? '(no subject)'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.isInBound ? `from ${m.from}` : `to ${Array.isArray(m.to) ? m.to.join(', ') : m.to}`} · {formatDate(m.date ?? m.createdDate)}
                    </span>
                  </span>
                  <Badge tone={/fail|error/i.test(String(m.status)) ? 'danger' : 'muted'}>{String(m.status ?? '—')}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pager page={page} pageCount={Math.ceil(total / pageSize)} total={total} onChange={setPage} />
        {open && (
          <div className="mt-4 space-y-2 border-t pt-4">
            <p className="text-sm font-medium">GetMailBoxMail</p>
            {detail.isPending ? <Spinner /> : detail.isError ? <ErrorNote error={detail.error} /> : <JsonView value={detail.data} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplatesTab() {
  const configs = useQuery({ queryKey: ['mail', 'configs'], queryFn: mail.configs, retry: false });
  const logicTpl = useQuery({ queryKey: ['mail', 'tpl', 'logic'], queryFn: mail.logicTemplates, retry: false });
  const osTpl = useQuery({ queryKey: ['mail', 'tpl', 'os'], queryFn: mail.osTemplates, retry: false });
  const box = (title: string, sub: string, q: { isPending: boolean; isError: boolean; error: unknown; data?: unknown }) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{sub}</CardDescription>
      </CardHeader>
      <CardContent>{q.isPending ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : <JsonView value={q.data} maxHeight="max-h-[50vh]" />}</CardContent>
    </Card>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {box('Mail servers', 'GET /logic/v4/Mail/Gets', configs)}
      {box('Templates (Logic)', 'GET /logic/v4/Template/Gets', logicTpl)}
      {box('Templates (OS)', 'GET /os/v4/Mail/GetTemplates — the purposes you can send', osTpl)}
    </div>
  );
}

function ComposeTab() {
  const { data: me } = useMe();
  const { language } = useI18n();
  const upload = useUploadFile();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [lang, setLang] = useState(language);
  const [subjectCtx, setSubjectCtx] = useState('{\n  "firstName": "Test"\n}');
  const [bodyCtx, setBodyCtx] = useState('{\n  "firstName": "Test"\n}');
  const [attachments, setAttachments] = useState<{ fileId: string; name: string }[]>([]);
  const [toAny, setToAny] = useState(false);
  const [isTest, setIsTest] = useState(true);
  const [phoneAsEmail, setPhoneAsEmail] = useState(false);

  const send = useMutation({
    mutationFn: () => {
      const input: SendMailInput = {
        to: splitList(to || me?.email || ''),
        cc: splitList(cc),
        bcc: splitList(bcc),
        replyTo: splitList(replyTo),
        purpose: purpose.trim(),
        language: lang.trim(),
        subjectDataContext: parseJsonInput<Record<string, string>>(subjectCtx, 'Subject data') ?? {},
        bodyDataContext: parseJsonInput<Record<string, string>>(bodyCtx, 'Body data') ?? {},
        attachments: attachments.map((a) => a.fileId),
        ...(phoneAsEmail ? { sendPhoneNumberAsEmail: true } : {}),
      };
      return toAny ? mail.sendToAny({ ...input, isTestMail: isTest }) : mail.send(input);
    },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Compose
          </CardTitle>
          <CardDescription>
            Subject and body come from the template matching <em>purpose</em> + <em>language</em>; the data contexts
            fill its placeholders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="To" hint={`Comma separated. Empty sends to you (${me?.email ?? '…'}).`}>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={me?.email} />
            </Field>
            <Field label="Reply-to">
              <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </Field>
            <Field label="Cc">
              <Input value={cc} onChange={(e) => setCc(e.target.value)} />
            </Field>
            <Field label="Bcc">
              <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </Field>
            <Field label="Purpose" hint="The template's purpose, exactly as saved in the console.">
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. welcome" />
            </Field>
            <Field label="Language">
              <Input value={lang} onChange={(e) => setLang(e.target.value)} />
            </Field>
            <Field label="Subject data context (JSON)">
              <Textarea mono rows={4} value={subjectCtx} onChange={(e) => setSubjectCtx(e.target.value)} />
            </Field>
            <Field label="Body data context (JSON)">
              <Textarea mono rows={4} value={bodyCtx} onChange={(e) => setBodyCtx(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Attachments</p>
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((a) => (
                <Badge key={a.fileId} tone="muted" className="gap-1">
                  {a.name}
                  <button
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setAttachments((prev) => prev.filter((p) => p.fileId !== a.fileId))}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                <Paperclip className="h-4 w-4" />
                {upload.isPending ? 'Uploading…' : 'Attach a file'}
                <input
                  type="file"
                  className="hidden"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    upload.mutate(file, {
                      onSuccess: (rec) =>
                        rec.fileId && setAttachments((prev) => [...prev, { fileId: rec.fileId!, name: rec.name ?? file.name }]),
                    });
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Uploaded to Storage first; the mail carries the file ids.</p>
            {upload.isError && <ErrorNote error={upload.error} />}
          </div>

          <div className="flex flex-wrap gap-6">
            <Checkbox label="Use SendToAny" hint="Same request plus isTestMail" checked={toAny} onChange={setToAny} />
            {toAny && <Checkbox label="isTestMail" checked={isTest} onChange={setIsTest} />}
            <Checkbox label="sendPhoneNumberAsEmail" checked={phoneAsEmail} onChange={setPhoneAsEmail} />
          </div>

          <Button onClick={() => send.mutate()} disabled={send.isPending || !purpose.trim()}>
            <Send className="h-4 w-4" /> {send.isPending ? 'Sending…' : 'Send'}
          </Button>
          {send.isError && <ErrorNote error={send.error} />}
          {send.data && <JsonView value={send.data} maxHeight="max-h-48" />}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, CheckCheck, Send } from 'lucide-react';
import { useMe } from '@/features/users/hooks';
import {
  describeNotification,
  notificationId,
  notifier,
  type NotifyInput,
  type SubscriptionFilter,
} from '@/features/notifications/api';
import { useInbox, useMarkAllRead, useMarkRead, useNotify } from '@/features/notifications/hooks';
import { useRealtimeStatus } from '@/features/notifications/realtime';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea, parseJsonInput, splitList } from '@/components/ui/form';
import { JsonView, PageHeader, Pager } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

const PAGE_SIZE = 10;

export function NotificationsPage() {
  const realtime = useRealtimeStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          <>
            Send real-time/offline notifications and work the signed-in user's inbox. Live connection:{' '}
            <Badge tone={realtime.state === 'connected' ? 'success' : realtime.state === 'off' ? 'muted' : 'danger'}>
              {realtime.state}
            </Badge>
            {realtime.detail && <span className="ml-1 text-xs">{realtime.detail}</span>}
          </>
        }
        endpoints={[
          'POST /logic/v4/Notifier/Notify',
          'GET /logic/v4/Notifier/GetNotifications',
          'POST /logic/v4/Notifier/MarkNotificationAsRead',
          'POST /logic/v4/Notifier/MarkAllNotificationAsRead',
          'GET /logic/v4/Notifier/GetUnreadNotificationsBySubscriptionFilter',
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <InboxCard />
        <div className="space-y-4">
          <SendCard />
          <LiveCard />
          <SubscriptionCard />
        </div>
      </div>
    </div>
  );
}

function InboxCard() {
  const [page, setPage] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inbox = useInbox({ page, pageSize: PAGE_SIZE, isUnreadOnly: unreadOnly, sortBy: 'CreatedTime', sortDescending: true });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = inbox.data?.notifications ?? [];
  const total = inbox.data?.totalNotificationsCount ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Inbox</CardTitle>
          <CardDescription>
            {inbox.data ? `${inbox.data.unReadNotificationsCount} unread of ${total}` : 'Your notifications'}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
          <CheckCheck className="h-4 w-4" /> Mark all read
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Checkbox
          label="Unread only"
          checked={unreadOnly}
          onChange={(v) => {
            setUnreadOnly(v);
            setPage(0);
          }}
        />
        {markAll.isError && <ErrorNote error={markAll.error} />}
        {markRead.isError && <ErrorNote error={markRead.error} />}
        {inbox.isPending ? (
          <Spinner />
        ) : inbox.isError ? (
          <ErrorNote error={inbox.error} />
        ) : items.length === 0 ? (
          <EmptyState title="No notifications" description="Send one to yourself from the form alongside." />
        ) : (
          <ul className="divide-y">
            {items.map((n) => {
              const id = notificationId(n);
              const { title, body } = describeNotification(n);
              return (
                <li key={id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-primary')} />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === id ? null : id)}>
                      <p className={cn('truncate text-sm', !n.isRead && 'font-medium')}>{title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{body}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDate(n.createdTime)}</p>
                    </button>
                    {!n.isRead && id && (
                      <Button variant="ghost" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(id)}>
                        Mark read
                      </Button>
                    )}
                  </div>
                  {expanded === id && <JsonView className="mt-2" value={n} maxHeight="max-h-60" />}
                </li>
              );
            })}
          </ul>
        )}
        <Pager zeroBased page={page} pageCount={Math.ceil(total / PAGE_SIZE)} total={total} onChange={setPage} />
      </CardContent>
    </Card>
  );
}

type Target = 'me' | 'users' | 'roles' | 'orgs' | 'filters';

function SendCard() {
  const { data: me } = useMe();
  const notify = useNotify();
  const [target, setTarget] = useState<Target>('me');
  const [ids, setIds] = useState('');
  const [title, setTitle] = useState('Hello from Construct OS');
  const [body, setBody] = useState('This notification was sent from the test app.');
  const [rawPayload, setRawPayload] = useState('');
  const [filters, setFilters] = useState('[{ "context": "orders", "actionName": "created", "value": "*" }]');
  const [asObject, setAsObject] = useState(true);
  const [configurationName, setConfigurationName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    try {
      const input: NotifyInput = {
        denormalizedPayload: rawPayload.trim() || JSON.stringify({ title, body, sentAt: new Date().toISOString() }),
        saveDenormalizedPayloadAsAnObject: asObject,
        ...(configurationName.trim() ? { configurationName: configurationName.trim() } : {}),
      };
      if (target === 'me') {
        if (!me?.itemId) throw new Error('No signed-in user id.');
        input.userIds = [me.itemId];
      } else if (target === 'users') input.userIds = splitList(ids);
      else if (target === 'roles') input.roles = splitList(ids);
      else if (target === 'orgs') input.organizationIds = splitList(ids);
      else input.subscriptionFilters = parseJsonInput<SubscriptionFilter[]>(filters, 'Subscription filters') ?? [];
      notify.mutate(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" /> Send a notification
        </CardTitle>
        <CardDescription>Target at least one of users, roles or subscription filters.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          <option value="me">Me ({me?.email ?? '…'})</option>
          <option value="users">User ids</option>
          <option value="roles">Roles (slugs)</option>
          <option value="orgs">Organizations (ids)</option>
          <option value="filters">Subscription filters</option>
        </Select>
        {(target === 'users' || target === 'roles' || target === 'orgs') && (
          <Input
            placeholder={target === 'roles' ? 'admin, editor' : 'id-1, id-2'}
            value={ids}
            onChange={(e) => setIds(e.target.value)}
          />
        )}
        {target === 'filters' && <Textarea mono rows={3} value={filters} onChange={(e) => setFilters(e.target.value)} />}
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea rows={2} placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
        <Textarea
          mono
          rows={2}
          placeholder="…or a raw denormalizedPayload (overrides title/body)"
          value={rawPayload}
          onChange={(e) => setRawPayload(e.target.value)}
        />
        <Input
          placeholder="Configuration name (optional)"
          value={configurationName}
          onChange={(e) => setConfigurationName(e.target.value)}
        />
        <Checkbox label="Save payload as an object" checked={asObject} onChange={setAsObject} />
        <Button onClick={submit} disabled={notify.isPending}>
          <Send className="h-4 w-4" /> {notify.isPending ? 'Sending…' : 'Send'}
        </Button>
        {error && <ErrorNote error={error} />}
        {notify.isError && <ErrorNote error={notify.error} />}
        {notify.data && <JsonView value={notify.data} maxHeight="max-h-40" />}
      </CardContent>
    </Card>
  );
}

/** What actually arrived over the hub — the proof a push was delivered in real time. */
function LiveCard() {
  const { events, connectionId, clearEvents } = useRealtimeStatus();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Live events</CardTitle>
          <CardDescription>
            Hub <code>/logic/v4/notificationHub</code>
            {connectionId && (
              <>
                {' '}· connection <code className="text-[11px]">{connectionId}</code>
              </>
            )}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={clearEvents}>
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing received yet. Send a notification to yourself — it should appear here without a reload.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <p className="text-xs text-muted-foreground">
                  {formatDate(e.at)} · <code>{e.method}</code>
                </p>
                <JsonView value={e.args.length === 1 ? e.args[0] : e.args} maxHeight="max-h-40" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SubscriptionCard() {
  const { data: me } = useMe();
  const [context, setContext] = useState('orders');
  const [actionName, setActionName] = useState('created');
  const [value, setValue] = useState('');
  const [orderBy, setOrderBy] = useState<1 | 2>(1);
  const query = useMutation({
    mutationFn: () => notifier.unreadBySubscription(me?.itemId ?? '', { context, actionName, value }, orderBy),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Unread by subscription filter</CardTitle>
        <CardDescription>
          Declared upstream as GET-with-body; sent here as query params, which the server may not read yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="context" value={context} onChange={(e) => setContext(e.target.value)} />
          <Input placeholder="actionName" value={actionName} onChange={(e) => setActionName(e.target.value)} />
          <Input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Select value={orderBy} onChange={(e) => setOrderBy(Number(e.target.value) as 1 | 2)}>
          <option value={1}>1 — newest first</option>
          <option value={2}>2 — unread first</option>
        </Select>
        <Button variant="outline" onClick={() => query.mutate()} disabled={query.isPending}>
          {query.isPending ? 'Querying…' : 'Query'}
        </Button>
        {query.isError && <ErrorNote error={query.error} />}
        {query.data && <JsonView value={query.data} maxHeight="max-h-60" />}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BellRing, CheckCheck, Send, Smartphone } from 'lucide-react';
import { useMe } from '@/features/users/hooks';
import {
  describeNotification,
  effectiveAudience,
  notificationId,
  notifier,
  type NotificationAudience,
  type NotificationConfig,
  type NotifyInput,
  type SubscriptionFilter,
} from '@/features/notifications/api';
import {
  useInbox,
  useMarkAllRead,
  useMarkRead,
  useNotificationConfigs,
  useNotify,
} from '@/features/notifications/hooks';
import { BlocksError } from '@/lib/blocks-client';
import { type RealtimeState, useRealtimeStatus } from '@/features/notifications/realtime';
import {
  deviceName,
  disablePush,
  enablePush,
  refreshPush,
  usePushStatus,
  type PushState,
} from '@/features/notifications/push';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, QueryState, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea, parseJsonInput, splitList } from '@/components/ui/form';
import { CopyButton, DetailList, JsonView, PageHeader, Pager } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

const PAGE_SIZE = 10;

const REALTIME_TONE: Record<RealtimeState, 'success' | 'muted' | 'danger'> = {
  connected: 'success',
  off: 'muted',
  connecting: 'danger',
  reconnecting: 'danger',
  failed: 'danger',
};

export function NotificationsPage() {
  const realtime = useRealtimeStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          <>
            Send real-time/offline notifications and work the signed-in user's inbox. Live connection:{' '}
            <Badge tone={REALTIME_TONE[realtime.state]}>{realtime.state}</Badge>
            {realtime.detail && <span className="ml-1 text-xs">{realtime.detail}</span>}
          </>
        }
        endpoints={[
          'GET /logic/v4/Notification/Gets',
          'POST /logic/v4/Notifier/Notify',
          'GET /logic/v4/Notifier/GetNotifications',
          'POST /logic/v4/Notifier/MarkNotificationAsRead',
          'POST /logic/v4/Notifier/MarkAllNotificationAsRead',
          'GET /logic/v4/Notifier/GetUnreadNotificationsBySubscriptionFilter',
          'GET /logic/v4/Notifier/push-web-config',
          'POST /logic/v4/Notifier/devices',
          'DELETE /logic/v4/Notifier/devices/{token}',
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <InboxCard />
        <div className="space-y-4">
          <SendCard />
          <PushCard />
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
        <QueryState
          query={inbox}
          empty={items.length === 0}
          emptyState={<EmptyState title="No notifications" description="Send one to yourself from the form alongside." />}
        >
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
        </QueryState>
        <Pager zeroBased page={page} pageCount={Math.ceil(total / PAGE_SIZE)} total={total} onChange={setPage} />
      </CardContent>
    </Card>
  );
}

type Target = 'me' | 'users' | 'roles' | 'orgs' | 'filters';

/** Who a send on this audience reaches, in one line; `warn` when that may surprise a tester. */
function audienceNote(a: NotificationAudience): { text: string; warn: boolean } {
  if (a.level === 1) {
    return { text: 'All users: everyone in your organization gets it, not only the target below.', warn: true };
  }
  if (a.level === 2) {
    const rules = [
      a.userIds?.length ? `${a.userIds.length} user(s)` : '',
      a.roles?.length ? `${a.roles.length} role(s)` : '',
      a.permissions?.length ? `${a.permissions.length} permission(s)` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const plusRules = rules ? `, plus ${rules}` : '';
    return a.alsoNamedUsers
      ? { text: `Targeted: the target below (Owner)${plusRules}.`, warn: false }
      : { text: `Targeted without Owner: only ${rules || 'its own rules'} get it — the target below may not.`, warn: true };
  }
  return { text: 'Affected users only: the target below.', warn: false };
}

function ConfigDetails({ config }: Readonly<{ config: NotificationConfig }>) {
  const audience = audienceNote(effectiveAudience(config));
  const channels = [
    config.liveEnabled === false ? '' : 'In-app',
    config.pushEnabled ? 'Push' : '',
    config.enablePersistence ? 'Offline' : '',
  ].filter(Boolean);
  const push = config.pushTemplate;
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <DetailList
        rows={[
          ['Description', config.description],
          [
            'Channels',
            channels.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {channels.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </span>
            ) : (
              'None'
            ),
          ],
          [
            'Audience',
            <span key="audience" className={cn(audience.warn && 'text-amber-600 dark:text-amber-400')}>
              {audience.text}
            </span>,
          ],
          ['Push text', push?.titleKey ? <code className="text-xs">{`${push.titleKey} / ${push.bodyKey}`}</code> : null],
          ['Hub method', config.notifyMethod ? <code className="text-xs">{config.notifyMethod}</code> : null],
        ]}
      />
      {config.isDisabled && (
        <p className="text-xs text-destructive">Disabled in Blocks OS: the send is accepted, but nothing goes out.</p>
      )}
    </div>
  );
}

function ConfigsError({ error }: Readonly<{ error: unknown }>) {
  if (error instanceof BlocksError && error.status === 403) {
    return (
      <ErrorNote error="Your role cannot list notification configurations. Give it the permission blocks-os::notification::gets (Roles page), then reload." />
    );
  }
  return <ErrorNote error={error} />;
}

/**
 * A test send for any configuration this app's users can receive. Logic needs a configuration
 * for every send, and the configuration — not this form — decides channels and receivers.
 */
function SendCard() {
  const { data: me } = useMe();
  const notify = useNotify();
  const configs = useNotificationConfigs();
  const [configId, setConfigId] = useState('');
  const [target, setTarget] = useState<Target>('me');
  const [ids, setIds] = useState('');
  const [title, setTitle] = useState('Hello from Construct OS');
  const [body, setBody] = useState('This notification was sent from the test app.');
  const [rawPayload, setRawPayload] = useState('');
  const [filters, setFilters] = useState('[{ "context": "orders", "actionName": "created", "value": "*" }]');
  const [asObject, setAsObject] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const config = configs.data?.find((c) => c.itemId === configId);

  const submit = () => {
    setError(null);
    try {
      if (!config) throw new Error('Choose a configuration.');
      const input: NotifyInput = {
        configurationName: config.name,
        denormalizedPayload: rawPayload.trim() || JSON.stringify({ title, body, sentAt: new Date().toISOString() }),
        saveDenormalizedPayloadAsAnObject: asObject,
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
          <BellRing className="h-4 w-4" /> Send a test notification
        </CardTitle>
        <CardDescription>
          Pick a configuration for consumer users and a target. The configuration decides the channels and who
          actually receives it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          aria-label="Configuration"
          value={configId}
          disabled={configs.isPending}
          onChange={(e) => setConfigId(e.target.value)}
        >
          <option value="">{configs.isPending ? 'Loading configurations…' : 'Choose a configuration'}</option>
          {configs.data?.map((c) => (
            <option key={c.itemId} value={c.itemId}>
              {c.name}
              {c.isBuiltIn ? ' · built-in' : ''}
              {c.isDisabled ? ' · disabled' : ''}
            </option>
          ))}
        </Select>
        {configs.isError && <ConfigsError error={configs.error} />}
        {configs.data?.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No configuration for consumer users yet. Add one in Blocks OS → Notification.
          </p>
        )}
        {config && <ConfigDetails config={config} />}
        <Select aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
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
        <Checkbox label="Save payload as an object" checked={asObject} onChange={setAsObject} />
        <Button onClick={submit} disabled={!config || notify.isPending}>
          <Send className="h-4 w-4" /> {notify.isPending ? 'Sending…' : 'Send'}
        </Button>
        {error && <ErrorNote error={error} />}
        {notify.isError && <ErrorNote error={notify.error} />}
        {notify.data && <JsonView value={notify.data} maxHeight="max-h-40" />}
      </CardContent>
    </Card>
  );
}

const PUSH_TONE: Record<PushState, 'default' | 'success' | 'muted' | 'danger'> = {
  idle: 'muted',
  working: 'default',
  unsupported: 'danger',
  'not-set-up': 'muted',
  blocked: 'danger',
  off: 'muted',
  on: 'success',
  failed: 'danger',
};

const PUSH_HINT: Partial<Record<PushState, string>> = {
  unsupported:
    'This browser cannot receive web push. On iPhone and iPad only a site installed to the Home Screen (iOS 16.4+) can, and this app is not installable yet.',
  'not-set-up':
    'Web push is not set up for this project. In Blocks OS → Notifications → Push settings: upload the Firebase service account key, add the web config and VAPID key, and switch Push and Web on.',
  blocked: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
  off: 'Turn it on to register this browser with Blocks for your user.',
  on: 'Registered. Send yourself a notification above with a configuration that has the Push channel — with this tab hidden or closed it arrives as a system notification.',
};

/**
 * Web push for this browser through Firebase. The config comes from Blocks OS, not from this
 * bundle, so the card works out what is possible before offering a button.
 */
function PushCard() {
  const { data: me } = useMe();
  const userId = me?.itemId;
  const { state, detail, projectId, token, received, clearReceived } = usePushStatus();

  useEffect(() => {
    // The app shell may already be re-registering an opted-in user; only an untouched state is checked.
    if (userId && usePushStatus.getState().state === 'idle') void refreshPush(userId);
  }, [userId]);

  const busy = state === 'working' || !userId;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" /> Push on this browser
          </CardTitle>
          <CardDescription>Firebase web push, delivered by the Blocks Notifier even with the app closed.</CardDescription>
        </div>
        <Badge tone={PUSH_TONE[state]}>{state}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {PUSH_HINT[state] && <p className="text-sm text-muted-foreground">{PUSH_HINT[state]}</p>}
        {detail && (state === 'failed' ? <ErrorNote error={detail} /> : <p className="text-xs text-muted-foreground">{detail}</p>)}

        <div className="flex flex-wrap gap-2">
          {state === 'off' && (
            <Button disabled={busy} onClick={() => userId && void enablePush(userId)}>
              Turn on push
            </Button>
          )}
          {state === 'on' && (
            <Button variant="outline" disabled={busy} onClick={() => userId && void disablePush(userId)}>
              Turn off
            </Button>
          )}
          {(state === 'failed' || state === 'not-set-up') && (
            <Button variant="outline" disabled={busy} onClick={() => userId && void refreshPush(userId)}>
              Check again
            </Button>
          )}
          {state === 'working' && <Spinner label="Working…" />}
        </div>

        {state === 'on' && token && (
          <DetailList
            rows={[
              ['Firebase project', projectId],
              ['Device', deviceName()],
              [
                'Token',
                <span key="token" className="flex items-center gap-1">
                  <code className="truncate text-[11px]">{token.slice(0, 24)}…</code>
                  <CopyButton text={token} />
                </span>,
              ],
            ]}
          />
        )}

        {received.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Received while this tab was open</p>
              <Button variant="ghost" size="sm" onClick={clearReceived}>
                Clear
              </Button>
            </div>
            <ul className="space-y-2">
              {received.map((p) => (
                <li key={p.id}>
                  <p className="text-sm font-medium">{p.title}</p>
                  {p.body && <p className="text-xs text-muted-foreground">{p.body}</p>}
                  <p className="text-[11px] text-muted-foreground">{formatDate(p.at)}</p>
                  <JsonView className="mt-1" value={p.payload} maxHeight="max-h-40" />
                </li>
              ))}
            </ul>
          </div>
        )}
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

import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Notifier — push a notification to users/roles/subscribers, and read the signed-in
 * user's own inbox.
 *
 * It lives under `/logic/v4/Notifier`, not a utilities base: that is where the gateway
 * routes it (and where the SDK points). Not to be confused with tenant notification
 * *channel configuration*, which is a different service and an admin concern.
 */

export const NOTIFIER_BASE = `${BLOCKS.apiUrl}/logic/v4/Notifier`;

export interface SubscriptionFilter {
  context?: string;
  actionName?: string;
  value?: string;
}

export interface NotifyInput {
  userIds?: string[];
  roles?: string[];
  /** Everyone in these orgs — or, combined with `roles`, only role holders within them. */
  organizationIds?: string[];
  subscriptionFilters?: SubscriptionFilter[];
  /** Free-form text the client receives. Usually a JSON string — see the flag below. */
  denormalizedPayload?: string;
  /** Store `denormalizedPayload` parsed, so clients get an object rather than a string. */
  saveDenormalizedPayloadAsAnObject?: boolean;
  configurationName?: string;
  connectionId?: string;
  contentAvailable?: boolean;
  responseKey?: string;
  responseValue?: string;
}

export interface InboxNotification {
  id?: string;
  itemId?: string;
  payload?: unknown;
  denormalizedPayload?: unknown;
  isRead?: boolean;
  createdTime?: string;
  correlationId?: string;
  [k: string]: unknown;
}

export interface Inbox {
  notifications: InboxNotification[];
  totalNotificationsCount: number;
  unReadNotificationsCount: number;
}

export interface InboxQuery {
  page?: number;
  pageSize?: number;
  isUnreadOnly?: boolean;
  filter?: string;
  sortBy?: string;
  sortDescending?: boolean;
}

export const notificationId = (n: InboxNotification) => String(n.id ?? n.itemId ?? '');

/**
 * Best-effort title/body from whatever the sender put in the payload. Senders are free to
 * send any shape, so this tries the common keys and falls back to the raw text.
 */
export function describeNotification(n: InboxNotification): { title: string; body: string } {
  const raw = n.denormalizedPayload ?? n.payload;
  let obj: Record<string, unknown> | null = null;
  if (raw && typeof raw === 'object') obj = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      /* plain text payload */
    }
  }
  if (obj) {
    const title = obj.title ?? obj.Title ?? obj.subject ?? obj.Subject ?? obj.name ?? 'Notification';
    const body = obj.body ?? obj.Body ?? obj.message ?? obj.Message ?? obj.text ?? JSON.stringify(obj);
    return { title: String(title), body: String(body) };
  }
  return { title: 'Notification', body: raw === undefined || raw === null ? '' : String(raw) };
}

export const notifier = {
  notify: (input: NotifyInput) =>
    blocksFetch<Record<string, unknown>>(`${NOTIFIER_BASE}/Notify`, { method: 'POST', body: input }),

  inbox: (q: InboxQuery = {}) => {
    const qs = new URLSearchParams();
    if (q.page !== undefined) qs.set('Page', String(q.page));
    if (q.pageSize !== undefined) qs.set('PageSize', String(q.pageSize));
    if (q.isUnreadOnly) qs.set('IsUnreadOnly', 'true');
    if (q.filter) qs.set('Filter', q.filter);
    if (q.sortBy) {
      qs.set('Sort.Property', q.sortBy);
      qs.set('Sort.IsDescending', String(q.sortDescending ?? true));
    }
    return blocksFetch<Inbox>(`${NOTIFIER_BASE}/GetNotifications?${qs}`);
  },

  markRead: (id: string) =>
    blocksFetch<unknown>(`${NOTIFIER_BASE}/MarkNotificationAsRead`, { method: 'POST', body: { id } }),

  markAllRead: () =>
    blocksFetch<unknown>(`${NOTIFIER_BASE}/MarkAllNotificationAsRead`, { method: 'POST', body: {} }),

  /**
   * Upstream declares this as a GET with a JSON body, which browsers cannot send. The
   * fields go in the query string instead — the server may ignore them until it reads
   * from there. `orderBy` must be 1 (newest first) or 2 (unread first): anything else,
   * including an omitted 0, silently returns an empty list.
   */
  unreadBySubscription: (userId: string, filter: SubscriptionFilter, orderBy: 1 | 2 = 1) => {
    const qs = new URLSearchParams({ UserId: userId, OrderBy: String(orderBy) });
    if (filter.context) qs.set('SubscriptionFilterData.Context', filter.context);
    if (filter.actionName) qs.set('SubscriptionFilterData.ActionName', filter.actionName);
    if (filter.value) qs.set('SubscriptionFilterData.Value', filter.value);
    return blocksFetch<InboxNotification[]>(`${NOTIFIER_BASE}/GetUnreadNotificationsBySubscriptionFilter?${qs}`);
  },
};

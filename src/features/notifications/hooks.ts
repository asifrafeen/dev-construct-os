import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifier, type InboxQuery, type NotifyInput } from './api';

const INBOX_KEY = ['notifier', 'inbox'] as const;

export const useInbox = (q: InboxQuery) =>
  useQuery({ queryKey: [...INBOX_KEY, q], queryFn: () => notifier.inbox(q) });

/**
 * The header badge. Polls as a fallback for when the real-time connection is not up;
 * a live push invalidates INBOX_KEY and refreshes it immediately.
 */
export const useUnreadCount = () =>
  useQuery({
    queryKey: [...INBOX_KEY, 'unread-count'],
    queryFn: () => notifier.inbox({ page: 0, pageSize: 1 }),
    select: (r) => r.unReadNotificationsCount ?? 0,
    refetchInterval: 60_000,
    retry: false,
  });

function useInboxInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: INBOX_KEY });
}

export function useMarkRead() {
  const invalidate = useInboxInvalidator();
  return useMutation({ mutationFn: (id: string) => notifier.markRead(id), onSuccess: invalidate });
}

export function useMarkAllRead() {
  const invalidate = useInboxInvalidator();
  return useMutation({ mutationFn: () => notifier.markAllRead(), onSuccess: invalidate });
}

export function useNotify() {
  const invalidate = useInboxInvalidator();
  // Sending to yourself is the quickest round-trip test, so refresh the inbox after.
  return useMutation({ mutationFn: (input: NotifyInput) => notifier.notify(input), onSuccess: invalidate });
}

export { INBOX_KEY };

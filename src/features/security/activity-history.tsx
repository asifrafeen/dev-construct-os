import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pager } from '@/components/ui/layout';
import { EmptyState, ErrorNote, Spinner } from '@/components/ui/misc';
import { cn, formatDate, formatRelative } from '@/lib/utils';
import { security, type ActivityItem } from './api';
import { securityErrorMessage } from './errors';

/**
 * The signed-in user's account history — sign-ins, failures, password and MFA changes —
 * laid out as blocks-iam's profile shows it: what happened, from which device and address,
 * and when. Leaving `userId` out of security/activity means "me".
 */

const PAGE_SIZE = 10;

function outcomeClass(outcome?: string): string {
  if (/fail|block|denied|error/i.test(outcome ?? '')) return 'text-destructive';
  if (/success/i.test(outcome ?? '')) return 'text-emerald-600 dark:text-emerald-400';
  return 'text-primary';
}

/** "desktop · Chrome on Windows", from whatever IAM captured off the request. */
function deviceLabel(item: ActivityItem): string {
  const info = item.context?.deviceInformation;
  const device = info?.device || item.context?.deviceName || 'Unknown device';
  return info?.browser && info.os ? `${device} · ${info.browser} on ${info.os}` : device;
}

export function ActivityHistory() {
  const [page, setPage] = useState(0);
  const activity = useQuery({
    queryKey: ['iam', 'security', 'activity', 'history', page],
    queryFn: () => security.activity({ page, pageSize: PAGE_SIZE }),
    retry: false,
  });
  const items = activity.data?.items ?? [];
  const total = activity.data?.totalCount ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account history</CardTitle>
        <CardDescription>Sign-ins and changes to your account, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <Spinner />
        ) : activity.isError ? (
          <ErrorNote error={securityErrorMessage(activity.error)} />
        ) : !items.length ? (
          <EmptyState title="No activity yet" description="Your account activity will show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Event</th>
                  <th className="px-2 py-2 font-medium">Device</th>
                  <th className="px-2 py-2 font-medium">IP address</th>
                  <th className="px-2 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.itemId} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      <span className={cn('font-medium', outcomeClass(a.outcome))}>{a.event}</span>
                      {a.reasonCode && <span className="block text-xs text-muted-foreground">{a.reasonCode}</span>}
                    </td>
                    <td className="px-2 py-2">{deviceLabel(a)}</td>
                    <td className="px-2 py-2 text-muted-foreground">{a.context?.ipAddress || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground" title={formatDate(a.createdDate)}>
                      {formatRelative(a.createdDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <Pager zeroBased page={page} pageCount={Math.ceil(total / PAGE_SIZE)} total={total} onChange={setPage} />
        )}
      </CardContent>
    </Card>
  );
}

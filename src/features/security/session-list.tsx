import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Monitor, Smartphone, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailList } from '@/components/ui/layout';
import { Badge, EmptyState, ErrorNote, Spinner } from '@/components/ui/misc';
import { Modal } from '@/components/ui/modal';
import { formatDate, formatRelative } from '@/lib/utils';
import { security, sessionStatusLabel, type RevokeResult, type SessionRow } from './api';
import { securityErrorMessage } from './errors';

/**
 * The devices the signed-in user is signed in on, as blocks-iam's own profile lists them:
 * one row per IdP session, however many apps ride on it, with "Sign out" for every live
 * session except this one. IAM refuses to revoke the current session from here
 * (400 cannot_revoke_current_session) — that is what the app's own sign-out is for.
 */

export const SESSIONS_KEY = ['iam', 'security', 'sessions'] as const;

function deviceIcon(operatingSystem?: string | null): LucideIcon {
  if (/android|ios|iphone|ipad/i.test(operatingSystem ?? '')) return Smartphone;
  if (/windows|mac|linux|chrome ?os/i.test(operatingSystem ?? '')) return Laptop;
  return Monitor;
}

/** "Chrome on Windows", or whichever half IAM could read off the user agent. */
function browserOnOs(browser?: string | null, operatingSystem?: string | null): string {
  return [browser, operatingSystem].filter(Boolean).join(' on ') || 'Unknown browser';
}

/** "1 app", "3 apps" — or "+2 more apps" next to the app this row is named after. */
function appSummary(count = 0): string {
  const extra = count - 1;
  if (extra > 0) return `+${extra} more app${extra === 1 ? '' : 's'}`;
  return `${count} app${count === 1 ? '' : 's'}`;
}

const isActive = (s: { status?: number | string | null }) => sessionStatusLabel(s.status) === 'Active';

function revokedMessage(result: RevokeResult | null | undefined): string {
  return result?.alreadyRevoked ? 'That device was already signed out.' : 'Device signed out.';
}

function useRevokeSession(onDone: (message: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => security.revokeSession(sessionId, 'Signed out from Construct OS profile'),
    onSuccess: (result) => {
      onDone(revokedMessage(result));
      void qc.invalidateQueries({ queryKey: SESSIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['iam', 'security', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['iam', 'security', 'activity'] });
    },
  });
}

export function SessionList() {
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => security.sessions(), retry: false });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SessionRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = [...(sessions.data ?? [])].sort(
    // This device first, then the most recently used.
    (a, b) =>
      Number(!!b.isCurrent) - Number(!!a.isCurrent) ||
      new Date(b.lastActivityAt ?? 0).getTime() - new Date(a.lastActivityAt ?? 0).getTime(),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Where you're signed in</CardTitle>
        <CardDescription>
          Sign out of any device you don't recognise. Select a session for its apps and history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}
        {sessions.isPending ? (
          <Spinner />
        ) : sessions.isError ? (
          <ErrorNote error={securityErrorMessage(sessions.error)} />
        ) : !rows.length ? (
          <EmptyState title="No sessions" description="You're not signed in on any other devices." />
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((s) => {
              const Icon = deviceIcon(s.primaryOperatingSystem);
              return (
                <li key={s.sessionId} className="flex items-center justify-between gap-2 hover:bg-muted/30">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
                    onClick={() => setDetailId(s.sessionId)}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="block min-w-0">
                      <span className="block truncate font-medium">{s.primaryDeviceName || 'Unknown device'}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {browserOnOs(s.primaryBrowser, s.primaryOperatingSystem)} · {appSummary(s.applicationCount)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" title={formatDate(s.lastActivityAt)}>
                        {s.primaryIpAddress || '—'} · last active {formatRelative(s.lastActivityAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 py-3 pr-4">
                    {s.isCurrent && <Badge>This device</Badge>}
                    {!isActive(s) ? (
                      <Badge tone="muted">{sessionStatusLabel(s.status)}</Badge>
                    ) : (
                      !s.isCurrent && (
                        <Button variant="outline" size="sm" onClick={() => setConfirming(s)}>
                          Sign out
                        </Button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {confirming && (
        <ConfirmSignOut
          session={confirming}
          onClose={() => setConfirming(null)}
          onDone={(message) => {
            setNotice(message);
            setConfirming(null);
          }}
        />
      )}
      {detailId && (
        <SessionDetailsModal
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onSignOut={(row) => {
            // One dialog at a time: each holds the body scroll lock and restores it on close.
            setDetailId(null);
            setConfirming(row);
          }}
        />
      )}
    </Card>
  );
}

function ConfirmSignOut({
  session,
  onClose,
  onDone,
}: {
  session: SessionRow;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const revoke = useRevokeSession(onDone);
  return (
    <Modal
      open
      onClose={onClose}
      title="Sign out of this device?"
      description={`This immediately ends the session on ${session.primaryDeviceName || 'this device'}, for every app signed in through it.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate(session.sessionId)}>
            {revoke.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {browserOnOs(session.primaryBrowser, session.primaryOperatingSystem)} · {session.primaryIpAddress || '—'}
      </p>
      {revoke.isError && <ErrorNote error={securityErrorMessage(revoke.error, 'blocks-iam::iam::mutate-security-audit')} />}
    </Modal>
  );
}

function SessionDetailsModal({
  sessionId,
  onClose,
  onSignOut,
}: {
  sessionId: string;
  onClose: () => void;
  onSignOut: (row: SessionRow) => void;
}) {
  const detail = useQuery({
    queryKey: ['iam', 'security', 'session', sessionId],
    queryFn: () => security.session(sessionId),
    retry: false,
  });
  const overview = detail.data?.overview;
  const canSignOut = !!overview && !overview.isCurrent && isActive(overview);

  return (
    <Modal
      open
      onClose={onClose}
      title={overview?.deviceName || 'Session'}
      description={<code className="text-xs">{sessionId}</code>}
      className="max-w-2xl"
      footer={
        canSignOut ? (
          <Button
            variant="outline"
            onClick={() =>
              onSignOut({
                sessionId,
                primaryDeviceName: overview.deviceName ?? undefined,
                primaryBrowser: overview.browser ?? undefined,
                primaryOperatingSystem: overview.operatingSystem ?? undefined,
                primaryIpAddress: overview.ipAddress ?? undefined,
              })
            }
          >
            Sign out of this device
          </Button>
        ) : undefined
      }
    >
      {detail.isPending ? (
        <Spinner />
      ) : detail.isError ? (
        <ErrorNote error={securityErrorMessage(detail.error)} />
      ) : !overview ? (
        <EmptyState title="Session not found" />
      ) : (
        <>
          <DetailList
            rows={[
              [
                'Status',
                <span className="flex items-center gap-2">
                  <Badge tone={isActive(overview) ? 'success' : 'muted'}>{sessionStatusLabel(overview.status)}</Badge>
                  {overview.isCurrent && <Badge>This device</Badge>}
                </span>,
              ],
              ['Device', [overview.deviceName, overview.deviceModel].filter(Boolean).join(' · ') || '—'],
              ['Browser', browserOnOs(overview.browser, overview.operatingSystem)],
              ['IP address', [overview.ipAddress, overview.location].filter(Boolean).join(' · ') || '—'],
              ['Started', formatDate(overview.startedAt)],
              ['Last active', `${formatRelative(overview.lastActivityAt)} · ${formatDate(overview.lastActivityAt)}`],
              ['Idle expiry', formatDate(overview.idleExpiry)],
              ['Absolute expiry', formatDate(overview.absoluteExpiry)],
            ]}
          />

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Apps on this session</h3>
            {!detail.data?.applications?.length ? (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {detail.data.applications.map((app, i) => (
                  <li key={`${app.clientId}-${i}`} className="space-y-0.5 px-3 py-2">
                    <p className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{app.clientName || app.clientId || 'Unknown app'}</span>
                      <Badge tone={isActive(app) ? 'success' : 'muted'}>{sessionStatusLabel(app.status)}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        app.grantType,
                        `expires ${formatDate(app.expiresAt)}`,
                        app.rotationCount ? `rotated ${app.rotationCount}×, last ${formatRelative(app.lastRotationAt)}` : null,
                        app.revokeReason ? `revoked: ${app.revokeReason}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Timeline</h3>
            {!detail.data?.timeline?.length ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="max-h-64 space-y-2 overflow-y-auto border-l pl-4 text-sm">
                {detail.data.timeline.map((t, i) => (
                  <li key={`${t.at}-${i}`}>
                    <p className="font-medium">{t.event || String(t.type ?? 'Event')}</p>
                    <p className="text-xs text-muted-foreground">
                      {[formatDate(t.at), t.outcome, t.reasonCode, t.clientId, t.ipAddress].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}

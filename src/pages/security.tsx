import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorSmartphone, QrCode, ShieldCheck } from 'lucide-react';
import { useMe, ME_KEY } from '@/features/users/hooks';
import { MfaCard } from '@/features/auth/mfa-card';
import { MFA_TYPE, mfaErrorMessage } from '@/features/auth/mfa';
import { ChangePasswordCard } from '@/features/security/change-password-card';
import { security, sessionStatusLabel, type SessionRow } from '@/features/security/api';
import { useAuthStore } from '@/state/auth-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/form';
import { DetailList, JsonView, PageHeader, Pager } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils';

export function SecurityPage() {
  const { data: me, isPending } = useMe();
  if (isPending) return <Spinner />;
  if (!me) return <ErrorNote error="No session" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Password, two-step verification, sessions and the account activity log."
        endpoints={[
          'POST /iam/v4/auth/change-password',
          'POST /iam/v4/idp/password-check',
          'POST /iam/v4/mfa/totp/setup',
          'PUT /iam/v4/mfa/method',
          'GET /iam/v4/security/sessions',
          'POST /iam/v4/security/activity',
          'POST /iam/v4/auth/logout-all',
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <ChangePasswordCard />
          <MfaCard me={me} />
          <TotpCard enrolled={me.mfaEnabled && me.userMfaType === MFA_TYPE.totp} mfaEnabled={me.mfaEnabled} activeType={me.userMfaType} />
        </div>
        <div className="space-y-4">
          <SessionsCard />
          <SignOutEverywhereCard />
          <ClaimsCard />
        </div>
      </div>
      <ActivityCard />
    </div>
  );
}

/**
 * Authenticator-app enrolment: setup returns a QR image and the raw secret, and the first
 * code from the app is what switches TOTP on.
 */
function TotpCard({ enrolled, mfaEnabled, activeType }: { enrolled: boolean; mfaEnabled: boolean; activeType: number }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const setup = useMutation({ mutationFn: security.totpSetup });
  const verify = useMutation({
    mutationFn: () => security.totpVerify(code.trim()),
    onSuccess: () => {
      setup.reset();
      setCode('');
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
  const method = useMutation({
    mutationFn: (t: 1 | 2) => security.setMethod(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4" /> Authenticator app (TOTP)
        </CardTitle>
        <CardDescription>
          {enrolled ? (
            <Badge tone="success">Active method</Badge>
          ) : (
            'Scan a QR code with Google/Microsoft Authenticator, then confirm with a code.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!setup.data ? (
          <Button variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()}>
            {setup.isPending ? 'Starting…' : enrolled ? 'Re-enrol authenticator' : 'Set up authenticator'}
          </Button>
        ) : (
          <div className="space-y-3">
            {setup.data.qrImageUrl && (
              <img src={setup.data.qrImageUrl} alt="TOTP QR code" className="h-44 w-44 rounded-md border bg-white p-2" />
            )}
            {setup.data.secret && (
              <p className="text-xs text-muted-foreground">
                Can't scan? Enter this key: <code className="break-all text-foreground">{setup.data.secret}</code>
              </p>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                verify.mutate();
              }}
            >
              <Input inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[10rem]" />
              <Button disabled={code.trim().length < 6 || verify.isPending}>Verify</Button>
            </form>
          </div>
        )}
        {setup.isError && <ErrorNote error={mfaErrorMessage(setup.error)} />}
        {verify.isError && <ErrorNote error={mfaErrorMessage(verify.error)} />}
        {verify.isSuccess && <p className="text-sm text-emerald-600">Authenticator enabled.</p>}

        <div className="border-t pt-3">
          <p className="mb-2 text-sm font-medium">Switch active method (PUT mfa/method)</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={method.isPending || (mfaEnabled && activeType === 1)} onClick={() => method.mutate(1)}>
              Use authenticator
            </Button>
            <Button size="sm" variant="outline" disabled={method.isPending || (mfaEnabled && activeType === 2)} onClick={() => method.mutate(2)}>
              Use email codes
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Email switches on with no code (it needs a verified address); TOTP must be enrolled first.
          </p>
          {method.isError && <ErrorNote error={mfaErrorMessage(method.error)} />}
        </div>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const summary = useQuery({ queryKey: ['iam', 'security', 'summary'], queryFn: () => security.summary(), retry: false });
  const sessions = useQuery({ queryKey: ['iam', 'security', 'sessions'], queryFn: () => security.sessions(), retry: false });
  const [detail, setDetail] = useState<SessionRow | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => security.revokeSession(id, 'Revoked from Construct OS'),
    onSuccess: () => {
      void sessions.refetch();
      void summary.refetch();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4" /> Sessions & devices
        </CardTitle>
        <CardDescription>Needs blocks-iam::iam::security-audit (revoke needs mutate-security-audit).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary.isError ? (
          <ErrorNote error={summary.error} />
        ) : summary.data ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="success">{summary.data.activeSessions ?? 0} active</Badge>
            <Badge tone="muted">{summary.data.expiredSessions ?? 0} expired</Badge>
            <Badge tone="muted">{summary.data.revokedSessions ?? 0} revoked</Badge>
            <span className="text-muted-foreground">last login {formatDate(summary.data.lastLoginAt)}</span>
          </div>
        ) : null}
        {revoke.isError && <ErrorNote error={revoke.error} />}
        {sessions.isPending ? (
          <Spinner />
        ) : sessions.isError ? (
          <ErrorNote error={sessions.error} />
        ) : !sessions.data?.length ? (
          <EmptyState title="No sessions" />
        ) : (
          <ul className="divide-y text-sm">
            {sessions.data.map((s) => (
              <li key={s.sessionId} className="flex items-center justify-between gap-2 py-2">
                <button className="min-w-0 text-left" onClick={() => setDetail(s)}>
                  <p className="truncate font-medium">
                    {[s.primaryBrowser, s.primaryOperatingSystem].filter(Boolean).join(' on ') || s.primaryDeviceName || 'Unknown device'}
                    {s.isCurrent && <Badge className="ml-2">this session</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.primaryIpAddress ?? '—'} · active {formatDate(s.lastActivityAt)} · {sessionStatusLabel(s.status)}
                  </p>
                </button>
                {!s.isCurrent && sessionStatusLabel(s.status) === 'Active' && (
                  <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s.sessionId)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {detail && <SessionDetailModal session={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}

function SessionDetailModal({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['iam', 'security', 'session', session.sessionId], queryFn: () => security.session(session.sessionId) });
  return (
    <Modal open onClose={onClose} title="Session" description={<code>{session.sessionId}</code>} className="max-w-2xl">
      <DetailList
        rows={[
          ['Created', formatDate(session.createdAt)],
          ['Idle expiry', formatDate(session.idleExpiry)],
          ['Absolute expiry', formatDate(session.absoluteExpiry)],
          ['Apps', (session.clientIds ?? []).join(', ') || '—'],
        ]}
      />
      {detail.isPending ? <Spinner /> : detail.isError ? <ErrorNote error={detail.error} /> : <JsonView value={detail.data} />}
    </Modal>
  );
}

function SignOutEverywhereCard() {
  const qc = useQueryClient();
  const [backchannel, setBackchannel] = useState(false);
  const run = useMutation({
    mutationFn: () => security.logoutAll(backchannel),
    onSuccess: async () => {
      useAuthStore.getState().clear();
      qc.setQueryData(ME_KEY, null);
      await qc.invalidateQueries();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LogOut className="h-4 w-4" /> Sign out everywhere
        </CardTitle>
        <CardDescription>Ends every session for this account — this browser included.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Checkbox
          label="Back-channel logout"
          hint="Also notify registered OIDC clients so they drop their sessions."
          checked={backchannel}
          onChange={setBackchannel}
        />
        <Button variant="destructive" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Signing out…' : 'Sign out of all devices'}
        </Button>
        {run.isError && <ErrorNote error={run.error} />}
      </CardContent>
    </Card>
  );
}

function ClaimsCard() {
  const claims = useMutation({ mutationFn: security.userinfo });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Token claims
        </CardTitle>
        <CardDescription>GET /iam/v4/auth/me — the OIDC userinfo view of this session.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" size="sm" disabled={claims.isPending} onClick={() => claims.mutate()}>
          Load claims
        </Button>
        {claims.isError && <ErrorNote error={claims.error} />}
        {claims.data && <JsonView value={claims.data} maxHeight="max-h-64" />}
      </CardContent>
    </Card>
  );
}

const CATEGORIES = ['Account', 'Audit', 'Auth', 'Resource'];

export function ActivityCard({ userId, title = 'My activity' }: { userId?: string; title?: string }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const pageSize = 15;
  const activity = useQuery({
    queryKey: ['iam', 'security', 'activity', userId ?? 'me', page, category, search],
    queryFn: () =>
      security.activity({
        page,
        pageSize,
        ...(userId ? { userId } : {}),
        ...(category ? { categories: [category] } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    retry: false,
  });
  const total = activity.data?.totalCount ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>POST /iam/v4/security/activity — logins, account changes and audit events.</CardDescription>
        </div>
        <div className="flex gap-2">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <Input className="w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <Spinner />
        ) : activity.isError ? (
          <ErrorNote error={activity.error} />
        ) : !activity.data?.items?.length ? (
          <EmptyState title="No activity recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Event</th>
                  <th className="px-2 py-2 font-medium">Outcome</th>
                  <th className="px-2 py-2 font-medium">Source / client</th>
                </tr>
              </thead>
              <tbody>
                {activity.data.items.map((a) => (
                  <tr key={a.itemId} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{formatDate(a.createdDate)}</td>
                    <td className="px-2 py-2">{a.category}</td>
                    <td className="px-2 py-2 font-mono text-xs">{a.event}</td>
                    <td className="px-2 py-2">
                      <Badge tone={/fail|denied|error/i.test(a.outcome ?? '') ? 'danger' : 'success'}>{a.outcome ?? '—'}</Badge>
                      {a.reasonCode && <span className="ml-1 text-xs text-muted-foreground">{a.reasonCode}</span>}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{[a.source, a.clientId].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager zeroBased page={page} pageCount={Math.ceil(total / pageSize)} total={total} onChange={setPage} />
      </CardContent>
    </Card>
  );
}

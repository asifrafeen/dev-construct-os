import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Blocks,
  Bot,
  Building2,
  Database,
  Fingerprint,
  FolderUp,
  Gauge,
  HeartPulse,
  KeyRound,
  Languages,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Package,
  ScrollText,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  UserCircle,
  UserPlus,
  Users,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useMe } from '@/features/users/hooks';
import { useLogout } from '@/features/auth/hooks';
import { useMyOrgsWithActive, useSwitchOrg } from '@/features/orgs/hooks';
import { authErrorMessage } from '@/features/auth/errors';
import { useT } from '@/features/localization/i18n';
import { LanguageSwitcher } from '@/features/localization/language-switcher';
import { useUnreadCount } from '@/features/notifications/hooks';
import { useNotificationStream } from '@/features/notifications/use-notification-stream';
import { useHeartbeatLoop } from '@/features/monitor/api';
import { useApiLog } from '@/state/api-log';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  to: string;
  /** Localization key; the English label is its fallback. */
  key: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Grouped by the Blocks service each screen exercises. */
const NAV: { key: string; label: string; items: NavItem[] }[] = [
  {
    key: 'NAV_GROUP_OVERVIEW',
    label: 'Overview',
    items: [
      { to: '/', key: 'NAV_DASHBOARD', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/health', key: 'NAV_HEALTH', label: 'Service health', icon: HeartPulse },
    ],
  },
  {
    key: 'NAV_GROUP_IAM',
    label: 'IAM',
    items: [
      { to: '/users', key: 'NAV_USERS', label: 'Users', icon: Users },
      { to: '/roles', key: 'NAV_ROLES', label: 'Roles', icon: ShieldCheck },
      { to: '/permissions', key: 'NAV_PERMISSIONS', label: 'Permissions', icon: KeyRound },
      { to: '/organizations', key: 'NAV_ORGANIZATIONS', label: 'Organizations', icon: Building2 },
      { to: '/one-click-signup', key: 'NAV_ONE_CLICK_SIGNUP', label: 'One-Click Sign-Up', icon: UserPlus },
      { to: '/security', key: 'NAV_SECURITY', label: 'Security', icon: Fingerprint },
      { to: '/iam-settings', key: 'NAV_IAM_SETTINGS', label: 'IAM settings', icon: Settings2 },
      { to: '/profile', key: 'NAV_PROFILE', label: 'Profile', icon: UserCircle },
    ],
  },
  {
    key: 'NAV_GROUP_DATA',
    label: 'Data',
    items: [
      { to: '/data', key: 'NAV_DATA', label: 'Data gateway', icon: Database },
      { to: '/storage', key: 'NAV_STORAGE', label: 'Storage', icon: FolderUp },
    ],
  },
  {
    key: 'NAV_GROUP_SERVICES',
    label: 'Services',
    items: [
      { to: '/localization', key: 'NAV_LOCALIZATION', label: 'Localization', icon: Languages },
      { to: '/notifications', key: 'NAV_NOTIFICATIONS', label: 'Notifications', icon: Bell },
      { to: '/mail', key: 'NAV_MAIL', label: 'Mail', icon: Mail },
      { to: '/workflows', key: 'NAV_WORKFLOWS', label: 'Workflows', icon: Workflow },
      { to: '/agents', key: 'NAV_AGENTS', label: 'AI agents', icon: Bot },
      { to: '/utilities', key: 'NAV_UTILITIES', label: 'Utilities', icon: Wrench },
    ],
  },
  {
    key: 'NAV_GROUP_OPS',
    label: 'Platform',
    items: [
      { to: '/build', key: 'NAV_BUILD', label: 'Build & release', icon: Package },
      { to: '/monitor', key: 'NAV_MONITOR', label: 'Monitor', icon: Gauge },
      { to: '/observability', key: 'NAV_OBSERVABILITY', label: 'Observability', icon: ScrollText },
      { to: '/secrets', key: 'NAV_SECRETS', label: 'Secrets', icon: LockKeyhole },
    ],
  },
  {
    key: 'NAV_GROUP_TOOLS',
    label: 'Tools',
    items: [
      { to: '/api-log', key: 'NAV_API_LOG', label: 'API inspector', icon: Activity },
      { to: '/playground', key: 'NAV_PLAYGROUND', label: 'API playground', icon: SquareTerminal },
    ],
  },
];

function OrgSwitcher() {
  const { orgs, activeOrgId, isPending, isError } = useMyOrgsWithActive();
  const switchOrg = useSwitchOrg();

  if (isPending) return <span className="text-xs text-muted-foreground">Loading orgs…</span>;
  if (isError || orgs.length === 0) return null;
  if (orgs.length === 1) return <span className="truncate text-sm font-medium">{orgs[0].name}</span>;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
        // Bound to the *session's* organization, not to what was clicked: on a refused
        // switch nothing was written, so the select snaps back on its own.
        value={activeOrgId ?? ''}
        disabled={switchOrg.isPending}
        onChange={(e) => switchOrg.mutate(e.target.value)}
      >
        {orgs.map((o) => (
          <option key={o.itemId} value={o.itemId}>
            {o.name}
          </option>
        ))}
      </select>

      {switchOrg.isPending && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Switching…
        </span>
      )}
      {switchOrg.isError && (
        <span className="truncate text-xs text-destructive" title={authErrorMessage(switchOrg.error)}>
          {authErrorMessage(switchOrg.error)}
        </span>
      )}
    </div>
  );
}

function NotificationBell() {
  const { data: unread } = useUnreadCount();
  return (
    <Button variant="ghost" size="icon" asChild aria-label="Notifications">
      <Link to="/notifications" className="relative">
        <Bell className="h-4 w-4" />
        {!!unread && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

/** Failed-request count since load — a quiet nudge that something is worth inspecting. */
function ApiLogIndicator() {
  const failures = useApiLog((s) => s.entries.filter((e) => !e.ok).length);
  return (
    <Button variant="ghost" size="icon" asChild aria-label="API inspector">
      <Link to="/api-log" className="relative" title={`${failures} failed request(s)`}>
        <Activity className="h-4 w-4" />
        {failures > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
        )}
      </Link>
    </Button>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {NAV.map((group) => (
        <div key={group.key}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {t(group.key, group.label)}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ to, key, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {t(key, label)}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { data: me } = useMe();
  const logout = useLogout();
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Live notifications, and the optional Monitor heartbeat, for as long as the signed-in
  // area is mounted.
  useNotificationStream();
  useHeartbeatLoop();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const signOut = (
    <div className="border-t p-3">
      <Button
        variant="ghost"
        className="w-full justify-start text-muted-foreground"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        <LogOut className="h-4 w-4" />
        {logout.isPending ? t('SIGNING_OUT', 'Signing out…') : t('SIGN_OUT', 'Sign out')}
      </Button>
    </div>
  );

  const brand = (
    <div className="flex h-16 shrink-0 items-center gap-2 border-b px-5">
      <Blocks className="h-5 w-5 text-primary" />
      <span className="font-semibold tracking-tight">Construct OS</span>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card md:flex">
        {brand}
        <Nav />
        {signOut}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col border-r bg-card">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Nav onNavigate={() => setMobileOpen(false)} />
            {signOut}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b px-4 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <OrgSwitcher />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <ApiLogIndicator />
            <NotificationBell />
            <ThemeToggle />
            <Link to="/profile" className="ml-1 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(me?.firstName, me?.lastName, me?.email?.[0]?.toUpperCase() ?? '?')}
              </div>
              <div className="hidden text-sm leading-tight lg:block">
                <p className="font-medium">
                  {[me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.email}
                </p>
                <p className="text-xs text-muted-foreground">{me?.email}</p>
              </div>
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

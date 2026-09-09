import { NavLink, Outlet } from 'react-router-dom';
import {
  Blocks,
  Building2,
  Database,
  FolderUp,
  LayoutDashboard,
  Loader2,
  LogOut,
  ShieldCheck,
  UserCircle,
  Users,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useMe } from '@/features/users/hooks';
import { useLogout } from '@/features/auth/hooks';
import { useMyOrgsWithActive, useSwitchOrg } from '@/features/orgs/hooks';
import { authErrorMessage } from '@/features/auth/errors';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/roles', label: 'Roles', icon: ShieldCheck },
  { to: '/organizations', label: 'Organizations', icon: Building2 },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/storage', label: 'Storage', icon: FolderUp },
  { to: '/profile', label: 'Profile', icon: UserCircle },
];

function OrgSwitcher() {
  const { orgs, activeOrgId, isPending, isError } = useMyOrgsWithActive();
  const switchOrg = useSwitchOrg();

  if (isPending) return <span className="text-xs text-muted-foreground">Loading orgs…</span>;
  if (isError || orgs.length === 0) return null;
  if (orgs.length === 1) return <span className="text-sm font-medium">{orgs[0].name}</span>;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
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

export function AppShell() {
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center gap-2 border-b px-5">
          <Blocks className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Construct OS</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" />
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b px-5">
          <OrgSwitcher />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(me?.firstName, me?.lastName, me?.email?.[0]?.toUpperCase() ?? '?')}
              </div>
              <div className="hidden text-sm leading-tight sm:block">
                <p className="font-medium">
                  {[me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.email}
                </p>
                <p className="text-xs text-muted-foreground">{me?.email}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

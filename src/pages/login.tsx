import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Blocks,
  Database,
  Loader2,
  Lock,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  getLoginOptions,
  loginWithPassword,
  startSocialLogin,
  type SsoProvider,
} from '@/features/auth/embedded';
import { authErrorMessage } from '@/features/auth/errors';
import { Captcha, useCaptcha } from '@/features/auth/captcha-widget';
import { ProviderButton } from '@/features/auth/provider-button';
import { startLogin } from '@/features/auth/sso';
import { ME_KEY, useIsLoggedIn } from '@/features/users/hooks';
import { BLOCKS, configIssues } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The sign-in page offers all three routes into the same session:
 *
 *   password + social  embedded — handled in-app, see features/auth/embedded.ts
 *   Continue with Blocks  hosted — bounces through the Blocks login, see features/auth/sso.ts
 *
 * They are not alternatives: each one ends with IAM setting the same HttpOnly
 * session cookie, and they return on different routes (/callback vs
 * /login/callback). VITE_BLOCKS_HOSTED_LOGIN=false hides the hosted button.
 */

/** pendingProvider marker for the hosted flow — never collides with a provider name. */
const HOSTED = '__blocks_hosted__';

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: 'One session, everywhere',
    body: 'Sign in once and the HttpOnly session cookie carries every call — no token in the browser.',
  },
  {
    icon: Users,
    title: 'Users and roles',
    body: 'Invite, activate and manage your project members from one place.',
  },
  {
    icon: Database,
    title: 'Data and storage',
    body: 'Query your collections and browse uploaded files without leaving the console.',
  },
];

/** Decorative dot grid for the brand panel — pure CSS, no asset to load. */
const DOT_GRID: CSSProperties = {
  backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

export function LoginPage() {
  const { isLoggedIn, isChecking } = useIsLoggedIn();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const issues = configIssues();

  /**
   * The challenge guards the password form only, and it is shown up front rather
   * than after a rejection: IAM will not tell us whether *this* account is close to
   * a lockout without being asked, so waiting for `captcha_enabled` would mean one
   * wasted round trip on every protected sign-in. The social and hosted buttons hand
   * off to a provider and never carry a code, so they stay unguarded.
   */
  const captcha = useCaptcha();

  // Which methods this project has switched on. A failure here is not fatal —
  // the password form still renders, it just cannot list providers.
  const { data: options, isPending: loadingOptions } = useQuery({
    queryKey: ['auth', 'login-options'],
    queryFn: getLoginOptions,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isChecking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Blocks className="h-6 w-6 text-primary" />
        </span>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking your session…
        </p>
      </div>
    );
  }

  if (isLoggedIn) return <Navigate to="/" replace />;

  const blocked = issues.length > 0;
  const providers = options?.ssoInfo ?? [];
  const hostedLogin = BLOCKS.hostedLogin && !!BLOCKS.oidcClientId;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithPassword(username, password, captcha.code || undefined);
      // The cookie now exists; /iam/me is the source of truth for the session.
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
      // A solved code is single-use, so a retry needs a fresh one whatever the
      // failure was. This also picks up the site key IAM names when it is the
      // rejection reason, which is how a project that switched CAPTCHA on since
      // this page loaded still gets a working challenge.
      captcha.handleError(e);
    } finally {
      setBusy(false);
    }
  }

  function onProvider(provider: SsoProvider) {
    setPendingProvider(provider.provider);
    setError(null);
    // Redirects the browser on success, so nothing after this resolves.
    startSocialLogin(provider).catch((e) => {
      setError(authErrorMessage(e));
      setPendingProvider(null);
    });
  }

  /** Hand off to the Blocks-hosted login; it returns on /login/callback. */
  function onHostedLogin() {
    setPendingProvider(HOSTED);
    setError(null);
    startLogin().catch((e) => {
      setError(authErrorMessage(e));
      setPendingProvider(null);
    });
  }

  return (
    <>
      {/* Build-pipeline probe: VITE_BLOCKS_EXTRA_ARG, printed verbatim and
          deliberately unstyled so it reads the same in either theme. Hidden
          entirely when the build supplied no value. */}
        <h1>Extra Arg</h1>
        {BLOCKS.extraArg && (
        <h1 style={{ background: '#fff', color: '#000', padding: '8px', textAlign: 'center' }}>
          {BLOCKS.extraArg}
        </h1>
      )}

      <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
        {/* ── Brand panel (large screens only) ───────────────────────────── */}
        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-secondary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div aria-hidden className="absolute inset-0 opacity-[0.15]" style={DOT_GRID} />
          <div
            aria-hidden
            className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-white/20 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-black/20 blur-3xl"
          />

          <div className="relative flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Blocks className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Construct OS</span>
          </div>

          <div className="relative max-w-md space-y-10">
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                Your project console, built on SELISE Blocks.
              </h1>
              <p className="text-base leading-relaxed text-primary-foreground/80">
                Everything your team ships — identity, data, storage — behind one sign-in.
              </p>
            </div>

            <ul className="space-y-6">
              {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="space-y-1">
                    <p className="font-medium leading-none">{title}</p>
                    <p className="text-sm leading-relaxed text-primary-foreground/75">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} SELISE · Powered by Blocks
          </p>
        </aside>

        {/* ── Sign-in panel ──────────────────────────────────────────────── */}
        <main className="relative flex flex-col justify-center bg-background px-6 py-12 sm:px-12">
          <div className="absolute right-4 top-4">
            <ThemeToggle />
          </div>

          <div className="mx-auto w-full max-w-sm duration-500 animate-in fade-in slide-in-from-bottom-2">
            {/* The brand panel is hidden below lg, so the mark repeats here. */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Blocks className="h-5 w-5 text-primary" />
              </span>
              <span className="text-lg font-semibold tracking-tight">Construct OS</span>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Welcome back Chief</h2>
              <p className="text-sm text-muted-foreground">Sign in to your Construct OS account.</p>
            </div>

            {blocked && (
              <div className="mt-6 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Configuration needed
                </p>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="username"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="you@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy || blocked}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground transition-colors hover:text-primary"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || blocked}
                />
              </div>

              {captcha.enabled && <Captcha {...captcha.props} className="flex justify-center" />}

              <Button
                type="submit"
                size="lg"
                className="group w-full"
                disabled={busy || blocked || !!pendingProvider || captcha.blocking}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            </form>

            {(error ?? captcha.loadError) != null && (
              <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error ?? captcha.loadError}
              </p>
            )}

            {(providers.length > 0 || hostedLogin) && (
              <>
                <div className="mt-8 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    or continue with
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                {providers.length > 0 && (
                  <div
                    className={`mt-4 grid gap-2 ${providers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
                  >
                    {providers.map((p) => (
                      <ProviderButton
                        key={p.provider}
                        provider={p}
                        busy={pendingProvider === p.provider}
                        disabled={busy || blocked || !!pendingProvider}
                        compact={providers.length > 2}
                        onSelect={onProvider}
                      />
                    ))}
                  </div>
                )}

                {hostedLogin && (
                  <Button
                    type="button"
                    variant="outline"
                    className={`w-full ${providers.length > 0 ? 'mt-2' : 'mt-4'}`}
                    disabled={busy || blocked || !!pendingProvider}
                    onClick={onHostedLogin}
                  >
                    <Blocks className="h-4 w-4 text-primary" />
                    <span>
                      {pendingProvider === HOSTED
                        ? 'Redirecting to SELISE Blocks…'
                        : 'SELISE Blocks'}
                    </span>
                  </Button>
                )}
              </>
            )}

            {loadingOptions && (
              <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading sign-in options…
              </p>
            )}

            <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Secured by SELISE Blocks
            </p>
          </div>
        </main>
      </div>
    </>
  );
}

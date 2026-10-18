import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/layout/app-shell';
import { RequireAuth } from '@/features/auth/require-auth';
import { LoginPage } from '@/pages/login';
import { LoginCallbackPage } from '@/pages/login-callback';
import { SocialCallbackPage } from '@/pages/social-callback';
import { ActivatePage } from '@/pages/activate';
import { SignupPage } from '@/pages/signup';
import { InvitationPage } from '@/pages/invitation';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { ResetPasswordPage } from '@/pages/reset-password';
import { DashboardPage } from '@/pages/dashboard';
import { NotFoundPage } from '@/pages/not-found';

/**
 * Route-level code splitting: each signed-in screen loads on first visit, so the sign-in
 * flow and the dashboard don't download every test page up front.
 */
const page =
  <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  async () => ({ Component: (await load())[name] });

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Must match VITE_BLOCKS_REDIRECT_URI and the registered redirectUri byte-for-byte.
  { path: '/login/callback', element: <LoginCallbackPage /> },
  // Embedded social login returns here — must match the redirect URI registered on
  // the provider (Google/Microsoft) and on the Blocks identity provider record.
  { path: '/callback', element: <SocialCallbackPage /> },
  // Self-service registration. Ends at the activation email rather than a session —
  // IAM creates the account inactive and the password is set on /activate.
  { path: '/signup', element: <SignupPage /> },
  // One-click signup links land here as `/invitation#link=<code>`. Set this URL as the
  // configuration's joinUrl in IAM (embedded mode); a Blocks OIDC link points at IAM's
  // own invitation page instead, and this page handles the code either way if you
  // compose the link yourself from the generate response.
  { path: '/invitation', element: <InvitationPage /> },
  // Reached from an invite email or from the link sign-up sends; not part of SSO login.
  { path: '/activate', element: <ActivatePage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  // IAM decides the recovery link's path from its own config: `oidc/recover/<tenantId>`
  // when the project is OIDC-enabled, otherwise the configured RecoverAccountPath.
  // Both land on the same page, which only reads `?code=`.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/oidc/recover/:tenantId', element: <ResetPasswordPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    // Shown while a lazily loaded screen downloads on a cold page load.
    HydrateFallback: () => (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'users', lazy: page(() => import('@/pages/users'), 'UsersPage') },
      { path: 'users/:userId', lazy: page(() => import('@/pages/user-detail'), 'UserDetailPage') },
      { path: 'organizations', lazy: page(() => import('@/pages/organizations'), 'OrganizationsPage') },
      { path: 'roles', lazy: page(() => import('@/pages/roles'), 'RolesPage') },
      { path: 'one-click-signup', lazy: page(() => import('@/pages/one-click-signup'), 'OneClickSignupPage') },
      { path: 'data', lazy: page(() => import('@/pages/data'), 'DataPage') },
      { path: 'storage', lazy: page(() => import('@/pages/storage'), 'StoragePage') },
      { path: 'profile', lazy: page(() => import('@/pages/profile'), 'ProfilePage') },
      { path: 'health', lazy: page(() => import('@/pages/health'), 'HealthPage') },
      { path: 'permissions', lazy: page(() => import('@/pages/permissions'), 'PermissionsPage') },
      { path: 'security', lazy: page(() => import('@/pages/security'), 'SecurityPage') },
      { path: 'iam-settings', lazy: page(() => import('@/pages/iam-settings'), 'IamSettingsPage') },
      { path: 'localization', lazy: page(() => import('@/pages/localization'), 'LocalizationPage') },
      { path: 'notifications', lazy: page(() => import('@/pages/notifications'), 'NotificationsPage') },
      { path: 'mail', lazy: page(() => import('@/pages/mail'), 'MailPage') },
      { path: 'workflows', lazy: page(() => import('@/pages/workflows'), 'WorkflowsPage') },
      { path: 'agents', lazy: page(() => import('@/pages/agents'), 'AgentsPage') },
      { path: 'utilities', lazy: page(() => import('@/pages/utilities'), 'UtilitiesPage') },
      { path: 'build', lazy: page(() => import('@/pages/build-info'), 'BuildInfoPage') },
      { path: 'monitor', lazy: page(() => import('@/pages/monitor'), 'MonitorPage') },
      { path: 'observability', lazy: page(() => import('@/pages/observability'), 'ObservabilityPage') },
      { path: 'secrets', lazy: page(() => import('@/pages/secrets'), 'SecretsPage') },
      { path: 'api-log', lazy: page(() => import('@/pages/api-log'), 'ApiLogPage') },
      { path: 'playground', lazy: page(() => import('@/pages/playground'), 'PlaygroundPage') },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

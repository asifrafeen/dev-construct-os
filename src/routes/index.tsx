import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/layout/app-shell';
import { RequireAuth } from '@/features/auth/require-auth';
import { LoginPage } from '@/pages/login';
import { LoginCallbackPage } from '@/pages/login-callback';
import { SocialCallbackPage } from '@/pages/social-callback';
import { ActivatePage } from '@/pages/activate';
import { SignupPage } from '@/pages/signup';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { ResetPasswordPage } from '@/pages/reset-password';
import { DashboardPage } from '@/pages/dashboard';
import { UsersPage } from '@/pages/users';
import { RolesPage } from '@/pages/roles';
import { UserDetailPage } from '@/pages/user-detail';
import { OrganizationsPage } from '@/pages/organizations';
import { ProfilePage } from '@/pages/profile';
import { StoragePage } from '@/pages/storage';
import { DataPage } from '@/pages/data';
import { NotFoundPage } from '@/pages/not-found';

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
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'users/:userId', element: <UserDetailPage /> },
      { path: 'organizations', element: <OrganizationsPage /> },
      { path: 'roles', element: <RolesPage /> },
      { path: 'data', element: <DataPage /> },
      { path: 'storage', element: <StoragePage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

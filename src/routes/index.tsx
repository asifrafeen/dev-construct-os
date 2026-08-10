import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/layout/app-shell';
import { RequireAuth } from '@/features/auth/require-auth';
import { LoginPage } from '@/pages/login';
import { LoginCallbackPage } from '@/pages/login-callback';
import { SocialCallbackPage } from '@/pages/social-callback';
import { ActivatePage } from '@/pages/activate';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { ResetPasswordPage } from '@/pages/reset-password';
import { DashboardPage } from '@/pages/dashboard';
import { UsersPage } from '@/pages/users';
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
  // Only reachable from an invite email; not part of SSO login.
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
      { path: 'data', element: <DataPage /> },
      { path: 'storage', element: <StoragePage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

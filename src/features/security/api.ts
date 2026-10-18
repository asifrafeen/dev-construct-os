import { blocksFetch } from '@/lib/blocks-client';
import { IAM_BASE } from '@/lib/env';

/**
 * Account security: password, TOTP, sessions and the activity log.
 *
 * The session/activity endpoints are called "self-service" by IAM but are permission-gated
 * (`blocks-iam::iam::security-audit`, `…::mutate-security-audit`) — a member without them
 * gets 403. Leaving out `uid`/`userId` means "me"; passing one reads someone else.
 */

const AUTH = `${IAM_BASE}/auth`;
const SEC = `${IAM_BASE}/security`;
const MFA = `${IAM_BASE}/mfa`;

export interface AccountResult {
  isSuccess?: boolean;
  errors?: Record<string, string> | null;
}

export interface SecuritySummary {
  currentSessionId?: string;
  totalSessions?: number;
  activeSessions?: number;
  expiredSessions?: number;
  revokedSessions?: number;
  lastActivityAt?: string;
  lastLoginAt?: string;
}

/** 0 Active, 1 Expired, 2 Revoked. */
export const SESSION_STATUS = ['Active', 'Expired', 'Revoked'];

export interface SessionRow {
  sessionId: string;
  createdAt?: string;
  lastActivityAt?: string;
  absoluteExpiry?: string;
  idleExpiry?: string;
  isCurrent?: boolean;
  status?: number;
  primaryDeviceName?: string;
  primaryOperatingSystem?: string;
  primaryBrowser?: string;
  primaryIpAddress?: string;
  applicationCount?: number;
  clientIds?: string[];
}

export interface ActivityItem {
  itemId: string;
  userId?: string;
  actorUserId?: string;
  category?: string;
  event?: string;
  outcome?: string;
  reasonCode?: string;
  severity?: string;
  source?: string;
  sessionId?: string;
  clientId?: string;
  entity?: string;
  entityId?: string;
  context?: unknown;
  createdDate?: string;
}

export interface ActivityQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  sessionId?: string;
  clientId?: string;
  events?: string[];
  outcomes?: string[];
  /** Account, Audit, Auth, Resource. */
  categories?: string[];
  from?: string;
  to?: string;
  search?: string;
}

const uidQs = (uid?: string) => (uid ? `?uid=${encodeURIComponent(uid)}` : '');

export const security = {
  /**
   * A wrong old password counts toward lockout (423 once locked), and when the project
   * has LogoutOnPasswordChange on, every session ends — this one included.
   */
  changePassword: (oldPassword: string, newPassword: string) =>
    blocksFetch<AccountResult>(`${AUTH}/change-password`, { method: 'POST', body: { oldPassword, newPassword } }),

  /** Live pass/fail against the project's password policy. Anonymous; answers a bare boolean. */
  passwordCheck: (password: string) =>
    blocksFetch<boolean>(`${IAM_BASE}/idp/password-check`, { method: 'POST', body: { password }, noRetry: true }),

  /** Sign out of every device and app; clears this browser's cookies too. */
  logoutAll: (useBackchannel = false) =>
    blocksFetch<{ isSuccess?: boolean; serviceLoggedOut?: number; sessionLoggedOut?: number; backchannelTriggered?: boolean }>(
      `${AUTH}/logout-all`,
      { method: 'POST', body: { useBackchannel } },
    ),

  /** OIDC userinfo claims for this session — the token's view, next to /iam/me's record view. */
  userinfo: () => blocksFetch<Record<string, unknown>>(`${AUTH}/me`),

  summary: (uid?: string) => blocksFetch<SecuritySummary>(`${SEC}/summary${uidQs(uid)}`),
  sessions: (uid?: string) => blocksFetch<SessionRow[]>(`${SEC}/sessions${uidQs(uid)}`),
  session: (sessionId: string, uid?: string) =>
    blocksFetch<Record<string, unknown>>(`${SEC}/sessions/${encodeURIComponent(sessionId)}${uidQs(uid)}`),
  /**
   * The body is always sent: the server reads `userId` off it without a null check.
   * The current session cannot be revoked here (400 cannot_revoke_current_session).
   */
  revokeSession: (sessionId: string, reason?: string, userId?: string) =>
    blocksFetch<Record<string, unknown>>(`${SEC}/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      method: 'POST',
      body: { ...(reason ? { reason } : {}), ...(userId ? { userId } : {}) },
    }),
  revokeRefreshToken: (tokenId: string, reason?: string, userId?: string) =>
    blocksFetch<unknown>(`${SEC}/refresh-tokens/${encodeURIComponent(tokenId)}/revoke`, {
      method: 'POST',
      body: { ...(reason ? { reason } : {}), ...(userId ? { userId } : {}) },
    }),

  /** Login history and audit trail — the replacement for the removed users/timeline. */
  activity: (q: ActivityQuery = {}) =>
    blocksFetch<{ items?: ActivityItem[]; totalCount?: number; page?: number; pageSize?: number }>(`${SEC}/activity`, {
      method: 'POST',
      body: { page: 0, pageSize: 20, ...q },
    }),

  /** Authenticator-app enrolment, step 1: a secret and a QR image to scan. */
  totpSetup: () => blocksFetch<{ qrImageUrl?: string; secret?: string }>(`${MFA}/totp/setup`, { method: 'POST', body: {} }),
  /** Step 2: the first code from the app proves it and turns TOTP on. */
  totpVerify: (code: string) =>
    blocksFetch<{ enabled?: boolean; method?: string }>(`${MFA}/totp/verify-setup`, { method: 'POST', body: { code } }),
  /**
   * Switch the active method. Only 1 (TOTP, must be enrolled) and 2 (Email, needs a
   * verified address — and enables with no code) are real; anything else DISABLES MFA.
   */
  setMethod: (mfaType: 1 | 2) => blocksFetch<unknown>(`${MFA}/method`, { method: 'PUT', body: { mfaType } }),
};

import { BlocksError } from '@/lib/blocks-client';

/**
 * The session and activity endpoints are self-service in name only: each one is a
 * ProtectedEndPoint, so a member whose role lacks the permission gets a bare 403.
 * Saying which permission is missing turns that into something an admin can act on.
 */
export function securityErrorMessage(error: unknown, permission = 'blocks-iam::iam::security-audit'): string {
  if (error instanceof BlocksError && error.status === 403) {
    return `Your role is missing the ${permission} permission, so IAM refused this (403).`;
  }
  return error instanceof Error ? error.message : String(error);
}

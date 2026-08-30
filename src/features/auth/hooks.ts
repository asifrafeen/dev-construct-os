import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logout } from './api';
import {
  confirmEmailMfaEnrolment,
  disableMfa,
  getMfaPolicy,
  resendMfaCode,
  startEmailMfaEnrolment,
} from './mfa';
import { useAuthStore } from '@/state/auth-store';
import { ME_KEY } from '@/features/users/hooks';

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } finally {
        // Always fall back to a signed-out UI, even if the network call failed.
        useAuthStore.getState().clear();
        qc.setQueryData(ME_KEY, null);
        await qc.invalidateQueries();
      }
    },
  });
}

/**
 * The project's MFA policy, or null when this user may not read it.
 *
 * `mfa/config` is permission-gated (`blocks-iam::iam::mfa-configs`) and an ordinary
 * member gets a 403. That is not an error worth showing: the policy only decorates
 * the UI, and IAM enforces the real rule when enrolment is attempted. So a failure
 * degrades to "unknown" and the screen keeps working.
 */
export function useMfaPolicy() {
  const { data, isPending } = useQuery({
    queryKey: ['iam', 'mfa', 'policy'],
    queryFn: async () => {
      try {
        return await getMfaPolicy();
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { policy: data ?? null, isLoading: isPending };
}

/** Step 1 of enrolment: mail a code and hand back the id that tracks it. */
export const useStartEmailMfa = () => useMutation({ mutationFn: startEmailMfaEnrolment });

/** Another code for an enrolment in flight. Resolves to the *replacement* mfaId. */
export const useResendMfaCode = () => useMutation({ mutationFn: resendMfaCode });

/**
 * Step 2: the code goes back and IAM enrols the user. /iam/me is re-read afterwards
 * because `mfaEnabled` and `userMfaType` live there, and nothing else refreshes them.
 */
export function useConfirmEmailMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mfaId, code }: { mfaId: string; code: string }) =>
      confirmEmailMfaEnrolment(mfaId, code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useDisableMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: disableMfa,
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

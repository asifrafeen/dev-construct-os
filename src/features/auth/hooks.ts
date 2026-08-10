import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout } from './api';
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

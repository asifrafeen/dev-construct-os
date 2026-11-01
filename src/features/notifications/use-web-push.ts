import { useEffect } from 'react';
import { useMe } from '@/features/users/hooks';
import { resumePush } from './push';

/**
 * Keeps this browser's push registration fresh for as long as the signed-in area is mounted.
 * Only a user who turned push on here is touched; everyone else is asked on the Notifications
 * page, never on load.
 */
export function useWebPush() {
  const { data: me } = useMe();
  const userId = me?.itemId;

  useEffect(() => {
    if (userId) void resumePush(userId);
  }, [userId]);
}

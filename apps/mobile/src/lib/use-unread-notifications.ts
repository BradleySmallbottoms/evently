import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { ensureIdentity } from '@/lib/identity';
import { loadNotificationsSeenCount } from '@/lib/notification-badge';
import { listNotifications } from '@/lib/notifications';

/** True when the inbox has notifications the user has not opened yet. */
export function useHasUnreadNotifications(): { hasUnread: boolean; numUnread: number } {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const queryClient = useQueryClient();
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const inbox = useQuery({
    queryKey: ['notifications', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listNotifications(identity.data!),
  });
  const seen = useQuery({
    queryKey: ['notifications-seen'],
    queryFn: loadNotificationsSeenCount,
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => sub.remove();
  }, [queryClient]);

  const unread = inbox.data?.unreadCount ?? 0;
  const seenCount = seen.data ?? 0;
  return {
    hasUnread: inbox.isSuccess && seen.isSuccess && unread > seenCount,
    numUnread: unread - seenCount,
  };
}

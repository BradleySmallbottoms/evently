import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { ensureIdentity } from '@/lib/identity';
import { loadNotificationsSeenAt } from '@/lib/notification-badge';
import { unreadSince } from '@/lib/unread-since';
import { listNotifications } from '@/lib/notifications';

/** True when an unread inbox row arrived after the list was last opened. */
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
    refetchInterval: 15_000,
  });
  const seen = useQuery({
    queryKey: ['notifications-seen'],
    queryFn: loadNotificationsSeenAt,
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => sub.remove();
  }, [queryClient]);

  const numUnread = unreadSince(inbox.data?.items ?? [], seen.data ?? null);
  return {
    hasUnread: inbox.isSuccess && seen.isSuccess && numUnread > 0,
    numUnread,
  };
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ensureIdentity } from '@/lib/identity';
import { cacheNotificationPresentationPrefs } from '@/lib/notification-presentation';
import { getPreferences } from '@/lib/preferences';
import { subscribeSilentPushHandlers } from '@/lib/push-notifications';

/** Keeps quiet-hours prefs cached and refreshes the inbox when a silent push arrives. */
export function InboxPushSync() {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
    retry: false,
  });

  useEffect(() => {
    void cacheNotificationPresentationPrefs({
      locale,
      quietHours: preferences.data?.quietHours,
    });
  }, [locale, preferences.data?.quietHours]);

  useEffect(() => {
    return subscribeSilentPushHandlers({
      getQuietHours: () => preferences.data?.quietHours,
      getLocale: () => locale,
      onInboxPing: () => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      },
    });
  }, [preferences.data?.quietHours, locale, queryClient]);

  return null;
}

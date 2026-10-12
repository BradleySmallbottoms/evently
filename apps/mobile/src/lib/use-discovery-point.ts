import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { FALLBACK_CENTER, resolveEventQueryPoint, type EventQueryPoint } from './events';
import { ensureIdentity } from './identity';
import { getPreferences, primaryCircleArea } from './preferences';

/** Saved preference area, then device location, then the Söderhamn launch center. */
export function useDiscoveryPoint(fallbackToLaunchArea = false) {
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
  const savedArea = primaryCircleArea(preferences.data?.areas ?? []);
  const point = useQuery({
    queryKey: [
      'event-query-point',
      fallbackToLaunchArea,
      savedArea?.lat,
      savedArea?.lng,
      savedArea?.radiusM,
    ],
    queryFn: async (): Promise<EventQueryPoint> => {
      if (fallbackToLaunchArea) return { ...FALLBACK_CENTER };
      if (savedArea) return savedArea;
      return resolveEventQueryPoint();
    },
    enabled: !identity.isPending && (identity.isError || !preferences.isLoading),
    retry: false,
  });
  return { identity, preferences, savedArea, point };
}

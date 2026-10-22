import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { countPublicEvents, type EventQueryPoint, type PublicEventCountFilter } from '@/lib/events';
import { EVENT_LIST_STALE_MS } from '@/lib/query-client';

const COUNT_DEBOUNCE_MS = 300;

function countKey(point: EventQueryPoint, filter: PublicEventCountFilter | undefined): string {
  return JSON.stringify({
    lat: point.lat,
    lng: point.lng,
    radiusM: point.radiusM,
    q: filter?.q ?? null,
    tagId: filter?.tagId ?? null,
    tagIds: [...(filter?.tagIds ?? [])].sort(),
    from: filter?.from ?? null,
    to: filter?.to ?? null,
    price: filter?.price ?? null,
  });
}

/** Count for the filters a Show events button will apply. Idle while `enabled` is false. */
export function useEventCount(
  point: EventQueryPoint | undefined,
  filter: PublicEventCountFilter | undefined,
  enabled: boolean,
) {
  const key = enabled && point ? countKey(point, filter) : '';
  const requests = useRef(
    new Map<string, { point: EventQueryPoint; filter: PublicEventCountFilter | undefined }>(),
  );
  const [settledKey, setSettledKey] = useState('');
  if (point && key) requests.current.set(key, { point, filter });
  for (const stored of requests.current.keys()) {
    if (stored !== key && stored !== settledKey) requests.current.delete(stored);
  }
  useEffect(() => {
    if (!key) {
      setSettledKey('');
      return;
    }
    const timer = setTimeout(() => setSettledKey(key), COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const query = useQuery({
    queryKey: ['event-count', settledKey],
    enabled: settledKey.length > 0,
    queryFn: () => {
      const request = requests.current.get(settledKey);
      if (!request) throw new Error('missing event count');
      return countPublicEvents(request.point, request.filter);
    },
    placeholderData: keepPreviousData,
    staleTime: EVENT_LIST_STALE_MS,
  });

  return query.data?.total;
}

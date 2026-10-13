import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { listPublicEvents, PUBLIC_EVENT_PAGE_SIZE, type EventQueryPoint } from '@/lib/events';
import { eventListFreshness } from '@/lib/query-client';

type PublicEventFilter = {
  q?: string;
  tagId?: string;
  tagIds?: string[];
  from?: string;
  to?: string;
  price?: 'free' | 'paid';
  sort?: 'soonest' | 'distance' | 'popular';
};

export function useInfinitePublicEvents(
  point: EventQueryPoint | undefined,
  filter: PublicEventFilter | undefined,
  queryKey: readonly unknown[],
) {
  return useInfiniteQuery({
    queryKey,
    enabled: point != null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPublicEvents(point!, {
        ...filter,
        offset: pageParam,
        limit: PUBLIC_EVENT_PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    // Another tag press reuses this list. After the stale window, a foreground
    // refetches every loaded page in place.
    ...eventListFreshness,
  });
}

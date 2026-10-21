import { useQuery } from '@tanstack/react-query';
import {
  FOR_YOU_CANDIDATE_LIMIT,
  FOR_YOU_HOME_COUNT,
  recentForYouSignals,
  selectForYouEvents,
} from '@local-events/domain';
import { useMemo } from 'react';

import { listMyCheckIns } from './check-in';
import { listPublicEvents, type EventQueryPoint } from './events';
import type { StoredIdentity } from './identity';
import { listComingEvents, listSavedEvents } from './library';
import { eventListFreshness } from './query-client';
import { listSubscriptions } from './subscriptions';

const TAG_QUERY_LIMIT = 100;

type Options = {
  point: EventQueryPoint | undefined;
  identity: StoredIdentity | undefined;
  /** Home chips have loaded, so an empty selection is real. */
  tagsReady: boolean;
  selectedTagIds: readonly string[];
  featuredIds: ReadonlySet<string>;
  limit?: number;
};

/**
 * For you: upcoming events in the selected area that resemble the latest saves,
 * coming marks, and check-ins, plus events from followed publishers.
 * Selected home tags narrow that set. Featured events are left out.
 */
export function useForYouEvents({
  point,
  identity,
  tagsReady,
  selectedTagIds,
  featuredIds,
  limit = FOR_YOU_HOME_COUNT,
}: Options) {
  const userId = identity?.userId;
  const saved = useQuery({
    queryKey: ['saved-events', userId],
    enabled: identity != null,
    queryFn: () => listSavedEvents(identity!),
  });
  const coming = useQuery({
    queryKey: ['coming-events', userId],
    enabled: identity != null,
    queryFn: () => listComingEvents(identity!),
  });
  const follows = useQuery({
    queryKey: ['subscriptions', userId],
    enabled: identity != null,
    queryFn: () => listSubscriptions(identity!),
  });
  const checkIns = useQuery({
    queryKey: ['my-check-ins', userId],
    enabled: identity != null,
    queryFn: () => listMyCheckIns(identity!),
  });

  const signals = useMemo(() => {
    const savedItems = recentForYouSignals(saved.data?.items ?? []);
    const comingItems = recentForYouSignals(coming.data?.items ?? []);
    const checkedIn = recentForYouSignals(
      (checkIns.data?.items ?? []).map((item) => ({
        id: item.eventId,
        tagIds: item.tagIds,
        publisherId: item.publisherId,
      })),
    );
    return [...savedItems, ...comingItems, ...checkedIn];
  }, [saved.data, coming.data, checkIns.data]);

  const excludeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of saved.data?.items ?? []) ids.add(item.id);
    for (const item of coming.data?.items ?? []) ids.add(item.id);
    for (const item of checkIns.data?.items ?? []) ids.add(item.eventId);
    return ids;
  }, [saved.data, coming.data, checkIns.data]);

  const followedPublisherIds = useMemo(
    () =>
      (follows.data?.items ?? [])
        .filter((item) => item.targetType === 'publisher')
        .map((item) => item.targetId),
    [follows.data],
  );

  const tasteTagIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const signal of signals) {
      for (const tagId of signal.tagIds) {
        if (seen.has(tagId)) continue;
        seen.add(tagId);
        ids.push(tagId);
        if (ids.length === TAG_QUERY_LIMIT) return ids;
      }
    }
    return ids;
  }, [signals]);

  const queryTagIds =
    selectedTagIds.length > 0 ? [...selectedTagIds].slice(0, TAG_QUERY_LIMIT) : tasteTagIds;
  const queryTagKey = [...queryTagIds].sort().join('\n');
  const followedKey = [...followedPublisherIds].sort().join('\n');
  const interactionsSettled =
    identity != null &&
    [saved, coming, follows, checkIns].every((query) => query.isSuccess || query.isError);
  const scanPublishers =
    followedPublisherIds.length > 0 && selectedTagIds.length === 0 && tasteTagIds.length > 0;

  const candidates = useQuery({
    queryKey: [
      'for-you',
      point?.lat,
      point?.lng,
      point?.radiusM,
      queryTagKey,
      followedKey,
      scanPublishers,
    ],
    ...eventListFreshness,
    enabled:
      point != null &&
      tagsReady &&
      interactionsSettled &&
      (queryTagIds.length > 0 || followedPublisherIds.length > 0),
    queryFn: async () => {
      const lists = [];
      if (queryTagIds.length > 0) {
        lists.push(
          await listPublicEvents(point!, {
            tagIds: queryTagIds,
            limit: FOR_YOU_CANDIDATE_LIMIT,
            sort: 'soonest',
          }),
        );
      } else {
        lists.push(
          await listPublicEvents(point!, { limit: FOR_YOU_CANDIDATE_LIMIT, sort: 'soonest' }),
        );
      }
      if (scanPublishers) {
        lists.push(
          await listPublicEvents(point!, { limit: FOR_YOU_CANDIDATE_LIMIT, sort: 'soonest' }),
        );
      }
      const byId = new Map<string, (typeof lists)[number]['items'][number]>();
      for (const list of lists) {
        for (const item of list.items) byId.set(item.id, item);
      }
      return [...byId.values()];
    },
  });

  const items = useMemo(
    () =>
      selectForYouEvents({
        candidates: candidates.data ?? [],
        signals,
        followedPublisherIds,
        selectedTagIds,
        featuredIds,
        excludeIds,
        limit,
      }),
    [
      candidates.data,
      signals,
      followedPublisherIds,
      selectedTagIds,
      featuredIds,
      excludeIds,
      limit,
    ],
  );

  const isLoading =
    identity != null &&
    tagsReady &&
    point != null &&
    (saved.isLoading ||
      coming.isLoading ||
      follows.isLoading ||
      checkIns.isLoading ||
      candidates.isLoading);

  async function refetch() {
    await Promise.all([
      saved.refetch(),
      coming.refetch(),
      follows.refetch(),
      checkIns.refetch(),
      candidates.refetch(),
    ]);
  }

  return { items, isLoading, refetch };
}

import { bucketMutations, type StatMutation, type StatsSourceType } from '@local-events/domain';

export type StatsWriter = {
  put(sourceType: StatsSourceType, sourceId: string, mutations: StatMutation[]): Promise<void>;
};

/** HTTP PUT to the public API (worker bearer token). Stats never write the DB from the worker. */
export function createHttpStatsWriter(baseUrl: string, workerToken: string): StatsWriter {
  const root = baseUrl.replace(/\/$/, '');
  return {
    async put(sourceType, sourceId, mutations) {
      if (mutations.length === 0) return;
      const res = await fetch(`${root}/stats/${sourceType}/${sourceId}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify(mutations),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`stats_put_failed:${res.status}:${text}`);
      }
    },
  };
}

export async function applyCheckInStats(
  writer: StatsWriter,
  input: { eventId: string; userId: string; publisherId: string },
  at: Date,
): Promise<void> {
  const eventOps = bucketMutations('numCheckins', 1, 'add', at);
  const userOps = bucketMutations('numEventsAttended', 1, 'add', at);
  const publisherOps = bucketMutations('numCheckins', 1, 'add', at);
  await writer.put('event', input.eventId, eventOps);
  await writer.put('user', input.userId, userOps);
  await writer.put('publisher', input.publisherId, publisherOps);
}

export async function applyRatingStats(
  writer: StatsWriter,
  input: { eventId: string; userId: string; publisherId: string; score: number },
  at: Date,
): Promise<void> {
  const eventOps = [
    ...bucketMutations('numRatings', 1, 'add', at),
    ...bucketMutations('totalRatingValue', input.score, 'add', at),
  ];
  const userOps = bucketMutations('numEventsRated', 1, 'add', at);
  const publisherOps = [
    ...bucketMutations('numRatings', 1, 'add', at),
    ...bucketMutations('totalRatingValue', input.score, 'add', at),
  ];
  await writer.put('event', input.eventId, eventOps);
  await writer.put('user', input.userId, userOps);
  await writer.put('publisher', input.publisherId, publisherOps);
}

export async function applyEngagementStats(
  writer: StatsWriter,
  baseKey: 'numSaved' | 'numComing',
  mode: 'add' | 'remove',
  eventId: string,
  at: Date,
): Promise<void> {
  await writer.put('event', eventId, bucketMutations(baseKey, 1, mode, at));
}

export async function applyPublishedStats(
  writer: StatsWriter,
  publisherId: string,
  at: Date,
): Promise<void> {
  await writer.put('publisher', publisherId, bucketMutations('numPublishedEvents', 1, 'add', at));
}

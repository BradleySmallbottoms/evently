import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  applyStatMutation,
  bucketMutations,
  type StatMutation,
  type StatsSourceType,
} from '@local-events/domain';
import { and, eq, inArray } from 'drizzle-orm';

export type StatsWriter = {
  put(
    sourceType: StatsSourceType,
    sourceId: string,
    mutations: StatMutation[],
  ): Promise<void>;
};

/** Apply mutations as-is (no bucket expansion) — same semantics as API PUT. */
export function createDbStatsWriter(db: Db, now: () => Date = () => new Date()): StatsWriter {
  return {
    async put(sourceType, sourceId, mutations) {
      if (mutations.length === 0) return;
      const at = now();
      const keys = [...new Set(mutations.map((m) => m.key))];
      const existing = await db
        .select()
        .from(schema.stats)
        .where(
          and(
            eq(schema.stats.sourceType, sourceType),
            eq(schema.stats.sourceId, sourceId),
            inArray(schema.stats.key, keys),
          ),
        );
      const byKey = new Map(existing.map((r) => [r.key, r.value as number]));

      for (const op of mutations) {
        const nextValue = applyStatMutation(byKey.get(op.key), op);
        byKey.set(op.key, nextValue);
        await db
          .insert(schema.stats)
          .values({
            sourceType,
            sourceId,
            key: op.key,
            value: nextValue,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoUpdate({
            target: [schema.stats.sourceType, schema.stats.sourceId, schema.stats.key],
            set: { value: nextValue, updatedAt: at },
          });
      }
    },
  };
}

/** HTTP PUT to the public API (worker bearer token). */
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

export async function applyPublishedStats(
  writer: StatsWriter,
  publisherId: string,
  at: Date,
): Promise<void> {
  await writer.put('publisher', publisherId, bucketMutations('numPublishedEvents', 1, 'add', at));
}

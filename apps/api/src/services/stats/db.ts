import type { StatEntry, StatsSourceType } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { applyStatMutation, type StatMutation } from '@local-events/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { StatsError, type StatsServices } from './types';

function assertWorkerToken(expected: string | undefined, provided: string | undefined): void {
  if (!expected || !provided || provided !== expected) {
    throw new StatsError('unauthorized');
  }
}

async function assertReadable(
  db: Db,
  auth: AuthServices,
  sourceType: StatsSourceType,
  sourceId: string,
  sessionToken: string | undefined,
): Promise<void> {
  if (sourceType === 'user') {
    const { userId } = await auth.requireUserSession(sessionToken);
    if (userId !== sourceId) throw new StatsError('forbidden');
    return;
  }
  if (sourceType === 'event') {
    const [event] = await db
      .select({ status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, sourceId))
      .limit(1);
    if (!event || event.status !== 'published') throw new StatsError('not_found');
    return;
  }
  const [publisher] = await db
    .select({ id: schema.publishers.id })
    .from(schema.publishers)
    .where(eq(schema.publishers.id, sourceId))
    .limit(1);
  if (!publisher) throw new StatsError('not_found');
}

function toEntry(row: {
  sourceType: StatsSourceType;
  sourceId: string;
  key: string;
  value: number;
  createdAt: Date;
  updatedAt: Date;
}): StatEntry {
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDbStatsServices(
  db: Db,
  auth: AuthServices,
  env: { workerToken?: string; now?: () => Date } = {},
): StatsServices {
  const now = env.now ?? (() => new Date());
  return {
    async getStats({ sourceType, sourceId, keys, sessionToken }) {
      if (keys.length === 0) throw new StatsError('bad_request');
      await assertReadable(db, auth, sourceType, sourceId, sessionToken);
      const rows = await db
        .select()
        .from(schema.stats)
        .where(
          and(
            eq(schema.stats.sourceType, sourceType),
            eq(schema.stats.sourceId, sourceId),
            inArray(schema.stats.key, keys),
          ),
        );
      return rows.map(toEntry);
    },

    async putStats({ sourceType, sourceId, mutations, workerToken }) {
      assertWorkerToken(env.workerToken, workerToken);
      if (mutations.length === 0) throw new StatsError('bad_request');
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
      const byKey = new Map(existing.map((r) => [r.key, r]));
      const results: StatEntry[] = [];

      for (const op of mutations) {
        const prev = byKey.get(op.key);
        const nextValue = applyStatMutation(prev?.value, op);
        if (prev) {
          const [row] = await db
            .update(schema.stats)
            .set({ value: nextValue, updatedAt: at })
            .where(
              and(
                eq(schema.stats.sourceType, sourceType),
                eq(schema.stats.sourceId, sourceId),
                eq(schema.stats.key, op.key),
              ),
            )
            .returning();
          if (row) {
            const entry = toEntry(row);
            byKey.set(op.key, row);
            results.push(entry);
          }
        } else {
          const [row] = await db
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
            })
            .returning();
          if (row) {
            byKey.set(op.key, row);
            results.push(toEntry(row));
          }
        }
      }
      return results;
    },
  };
}

export type { StatMutation };

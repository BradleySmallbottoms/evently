import type { StatEntry, StatsSourceType } from '@local-events/contracts';
import { applyStatMutation, type StatMutation } from '@local-events/domain';
import type { AuthServices } from '../auth/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { StatsError, type StatsServices } from './types';

function rowKey(sourceType: StatsSourceType, sourceId: string, key: string): string {
  return `${sourceType}:${sourceId}:${key}`;
}

function assertWorkerToken(expected: string | undefined, provided: string | undefined): void {
  if (!expected || !provided || provided !== expected) {
    throw new StatsError('unauthorized');
  }
}

export function createMemoryStatsServices(
  auth: AuthServices,
  store: MemoryStore = createMemoryStore(),
  env: { workerToken?: string; now?: () => Date } = {},
): StatsServices {
  const now = env.now ?? (() => new Date());
  return {
    async getStats({ sourceType, sourceId, keys, sessionToken }) {
      if (keys.length === 0) throw new StatsError('bad_request');
      if (sourceType === 'user') {
        const { userId } = await auth.requireUserSession(sessionToken);
        if (userId !== sourceId) throw new StatsError('forbidden');
      } else if (sourceType === 'event') {
        const event = store.events.get(sourceId);
        if (!event || event.status !== 'published') throw new StatsError('not_found');
      } else if (!store.publishers.has(sourceId)) {
        throw new StatsError('not_found');
      }
      const items: StatEntry[] = [];
      for (const key of keys) {
        const row = store.stats.get(rowKey(sourceType, sourceId, key));
        if (row) {
          items.push({
            sourceType,
            sourceId,
            key,
            value: row.value,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          });
        }
      }
      return items;
    },

    async putStats({ sourceType, sourceId, mutations, workerToken }) {
      assertWorkerToken(env.workerToken, workerToken);
      if (mutations.length === 0) throw new StatsError('bad_request');
      const at = now();
      const results: StatEntry[] = [];
      for (const op of mutations as StatMutation[]) {
        const id = rowKey(sourceType, sourceId, op.key);
        const prev = store.stats.get(id);
        const value = applyStatMutation(prev?.value, op);
        const createdAt = prev?.createdAt ?? at;
        store.stats.set(id, { value, createdAt, updatedAt: at });
        results.push({
          sourceType,
          sourceId,
          key: op.key,
          value,
          createdAt: createdAt.toISOString(),
          updatedAt: at.toISOString(),
        });
      }
      return results;
    },
  };
}

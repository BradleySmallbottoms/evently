import { describe, expect, it } from 'vitest';
import type { Db } from '../../../packages/db/src/index';
import { handleDuePushMessages } from '../../../apps/worker/src/notify/handle-due-push';

/** Raw sql`` chunks that are Date objects crash postgres-js at bind time. */
function sqlChunksContainDate(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof Date) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!('queryChunks' in value) || !Array.isArray(value.queryChunks)) return false;
  return value.queryChunks.some((chunk) => sqlChunksContainDate(chunk, seen));
}

function thenableEmpty() {
  const chain = {
    then(
      onFulfilled?: ((value: unknown[]) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  const proxy: object = new Proxy(chain, {
    get(target, prop, receiver) {
      if (prop === 'then') return Reflect.get(target, prop, receiver);
      return () => proxy;
    },
  });
  return proxy;
}

describe('handleDuePushMessages', () => {
  it('binds claim timestamps as strings, not Date objects', async () => {
    const executed: unknown[] = [];
    const db = {
      select: () => thenableEmpty(),
      execute: async (query: unknown) => {
        executed.push(query);
        return [];
      },
    } as unknown as Db;

    const now = new Date('2026-10-12T20:19:47.444Z');
    await handleDuePushMessages({
      db,
      expo: { send: async () => [] },
      now: () => now,
    });

    expect(executed.length).toBeGreaterThan(0);
    for (const query of executed) {
      expect(sqlChunksContainDate(query)).toBe(false);
    }
    const claim = executed[0];
    expect(sqlChunksContainDate(claim)).toBe(false);
    expect(JSON.stringify(claim)).toContain(now.toISOString());
    expect(JSON.stringify(claim)).toContain('2026-10-12T20:14:47.444Z');
  });
});

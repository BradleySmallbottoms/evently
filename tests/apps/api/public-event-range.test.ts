import { describe, expect, it } from 'vitest';
import type { AuthServices } from '../../../apps/api/src/services/auth/types';
import { createDbEventServices } from '../../../apps/api/src/services/events/db';
import type { Db } from '../../../packages/db/src/index';

/** postgres.js throws if a Date is bound in a query that also uses AT TIME ZONE. */
function containsDate(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof Date) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsDate(item, seen));
  return Object.values(value).some((nested) => containsDate(nested, seen));
}

function collectStrings(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, seen, out);
    return out;
  }
  for (const nested of Object.values(value)) collectStrings(nested, seen, out);
  return out;
}

function recordingDb(captured: unknown[]): Db {
  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where(clause: unknown) {
      captured.push(clause);
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
      return chain;
    },
    then(resolve: (rows: unknown[]) => unknown, reject?: (err: unknown) => unknown) {
      return Promise.resolve([]).then(resolve, reject);
    },
  };
  return {
    select() {
      return chain;
    },
  } as unknown as Db;
}

describe('public event date range', () => {
  const until = '2026-10-31T22:59:59.999Z';

  it('binds the calendar upper bound as text beside AT TIME ZONE', async () => {
    const captured: unknown[] = [];
    const events = createDbEventServices(recordingDb(captured), {} as AuthServices, {
      now: () => new Date('2026-10-28T22:00:00.000Z'),
    });

    await events.listPublicEvents({
      lat: 61.303,
      lng: 17.058,
      radiusM: 25_000,
      from: '2026-09-30T22:00:00.000Z',
      to: until,
      sort: 'soonest',
      limit: 20,
      offset: 0,
    });
    await events.countPublicEvents({
      lat: 61.303,
      lng: 17.058,
      radiusM: 25_000,
      from: '2026-09-30T22:00:00.000Z',
      to: until,
    });

    expect(captured).toHaveLength(2);
    expect(containsDate(captured)).toBe(false);
    const text = collectStrings(captured).join('\n');
    expect(text).toContain(until);
    expect(text).toContain('::timestamptz');
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../../../packages/db/src/index';
import {
  approveOpenPushMessagesForPublisher,
  approvePendingPushMessagesForEvent,
} from '../../../packages/db/src/push-messages';

function sqlChunksContainDate(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof Date) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!('queryChunks' in value) || !Array.isArray(value.queryChunks)) return false;
  return value.queryChunks.some((chunk) => sqlChunksContainDate(chunk, seen));
}

describe('approveOpenPushMessagesForPublisher', () => {
  it('binds timestamps as ISO strings', async () => {
    let query: unknown;
    const db = {
      execute: async (q: unknown) => {
        query = q;
        return [];
      },
    } as unknown as Db;
    const now = new Date('2026-10-12T20:19:47.444Z');

    await expect(
      approveOpenPushMessagesForPublisher(db, '11111111-1111-4111-8111-111111111101', now),
    ).resolves.toBe(0);

    expect(sqlChunksContainDate(query)).toBe(false);
    expect(JSON.stringify(query)).toContain(now.toISOString());
  });
});

describe('approvePendingPushMessagesForEvent', () => {
  it('approves only pending rows for that event', async () => {
    let query: unknown;
    const db = {
      execute: async (q: unknown) => {
        query = q;
        return [{ id: '1' }];
      },
    } as unknown as Db;
    const now = new Date('2026-10-14T08:00:00.000Z');
    const eventId = '11111111-1111-4111-8111-111111111111';

    await expect(approvePendingPushMessagesForEvent(db, eventId, now)).resolves.toBe(1);
    expect(sqlChunksContainDate(query)).toBe(false);
    const sqlText = JSON.stringify(query);
    expect(sqlText).toContain(now.toISOString());
    expect(sqlText).toContain(eventId);
    expect(sqlText).toContain('pending');
  });
});

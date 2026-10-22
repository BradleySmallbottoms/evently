import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/worker/src/notify/match', () => ({
  loadPushDevicesForUsers: async () => [],
  countUnreadNotifications: async () => 1,
}));

import { markTipPublished } from '../../../packages/db/src/tips';
import { handleTipScanned } from '../../../apps/worker/src/notify/handle-tip';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TIP_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function selects(...pages: unknown[][]) {
  const queue = [...pages];
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => queue.shift() ?? [],
      }),
    }),
  });
}

describe('markTipPublished', () => {
  it('updates only a scanned tip that is still in review', async () => {
    let whereArg: unknown;
    const db = {
      update: () => ({
        set: () => ({
          where: (arg: unknown) => {
            whereArg = arg;
            return { returning: async () => [{ id: TIP_ID }] };
          },
        }),
      }),
    };
    const now = new Date('2026-10-22T12:00:00.000Z');
    await expect(markTipPublished(db as never, EVENT_ID, now)).resolves.toEqual({ id: TIP_ID });
    expect(whereArg).toBeTruthy();
  });
});

describe('published tip notice', () => {
  it('sends one follow-up when the review notice already exists', async () => {
    const inserted: unknown[] = [];
    const db = {
      select: selects(
        [{ id: TIP_ID, userId: USER_ID, locale: 'sv' }],
        [{ id: 'notice' }],
        [{ title: 'Krusmyntanätterna', venueName: 'Krusmyntagården' }],
      ),
      insert: () => ({
        values: async (row: unknown) => {
          inserted.push(row);
        },
      }),
    };
    await handleTipScanned(
      { tipId: TIP_ID, eventId: EVENT_ID, status: 'published' },
      { db: db as never, expo: { send: vi.fn() } },
      { followUp: true },
    );
    expect(inserted).toHaveLength(1);
  });

  it('does not send the follow-up twice', async () => {
    const inserted: unknown[] = [];
    const db = {
      select: selects(
        [{ id: TIP_ID, userId: USER_ID, locale: 'sv' }],
        [{ id: 'review' }, { id: 'published' }],
      ),
      insert: () => ({
        values: async (row: unknown) => {
          inserted.push(row);
        },
      }),
    };
    await handleTipScanned(
      { tipId: TIP_ID, eventId: EVENT_ID, status: 'published' },
      { db: db as never, expo: { send: vi.fn() } },
      { followUp: true },
    );
    expect(inserted).toHaveLength(0);
  });
});

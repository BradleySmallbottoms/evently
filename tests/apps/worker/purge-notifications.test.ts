import { describe, expect, it, vi } from 'vitest';
import { purgeExpiredNotifications } from '../../../apps/worker/src/notify/match';

describe('purgeExpiredNotifications', () => {
  it('deletes in batches until none remain', async () => {
    const ids1 = Array.from({ length: 2 }, (_, i) => `id-${i}`);
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: async () => ids1.map((id) => ({ id })),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      });
    const del = vi.fn().mockReturnValue({
      where: async () => undefined,
    });
    const db = { select, delete: del } as never;

    const deleted = await purgeExpiredNotifications(db, new Date('2026-06-15T12:00:00.000Z'), 90, 2);
    expect(deleted).toBe(2);
    expect(del).toHaveBeenCalledOnce();
  });
});

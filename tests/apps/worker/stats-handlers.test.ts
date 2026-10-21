import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processMessage } from '../../../apps/worker/src/handlers';

const put = vi.fn(async () => undefined);

vi.mock('../../../apps/worker/src/notify/handle-published', () => ({
  handleEventPublished: vi.fn(async () => ({ matched: 0, sent: 0, skipped: 0, deferred: 0 })),
}));

describe('stats domain event handlers', () => {
  beforeEach(() => {
    put.mockClear();
  });

  it('emits multi-key adds on checkin.created and rating.created', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ publisherId: '33333333-3333-4333-8333-333333333333' }]),
          })),
        })),
      })),
    };
    const stats = { put };
    const now = () => new Date('2026-06-15T12:00:00.000Z');

    await processMessage(
      JSON.stringify({
        type: 'checkin.created',
        eventId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      }),
      { db: db as never, stats, now },
    );
    expect(put).toHaveBeenCalled();
    const eventCall = put.mock.calls.find((c) => c[0] === 'event');
    expect(eventCall?.[2]?.some((m: { key: string }) => m.key === 'numCheckins')).toBe(true);
    expect(eventCall?.[2]?.some((m: { key: string }) => m.key.startsWith('numCheckins-w'))).toBe(
      true,
    );

    put.mockClear();
    await processMessage(
      JSON.stringify({
        type: 'rating.created',
        eventId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        score: 4,
      }),
      { db: db as never, stats, now },
    );
    const ratingEvent = put.mock.calls.find((c) => c[0] === 'event');
    expect(
      ratingEvent?.[2]?.some(
        (m: { key: string; add?: number }) => m.key === 'totalRatingValue' && m.add === 4,
      ),
    ).toBe(true);
  });

  it('increments publisher published count after event.published', async () => {
    const selectChain = {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ publisherId: '33333333-3333-4333-8333-333333333333' }]),
        })),
      })),
    };
    const db = { select: vi.fn(() => selectChain) };
    const stats = { put };

    await processMessage(
      JSON.stringify({
        type: 'event.published',
        eventId: '11111111-1111-4111-8111-111111111111',
      }),
      {
        db: db as never,
        stats,
        notify: { db: db as never, expo: { send: vi.fn() } } as never,
        now: () => new Date('2026-01-05T12:00:00.000Z'),
      },
    );
    expect(put).toHaveBeenCalledWith(
      'publisher',
      '33333333-3333-4333-8333-333333333333',
      expect.arrayContaining([expect.objectContaining({ key: 'numPublishedEvents', add: 1 })]),
    );
  });

  it('adds and removes numSaved and numComing buckets', async () => {
    const stats = { put };
    const now = () => new Date('2026-06-15T12:00:00.000Z');
    const eventId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';

    await processMessage(JSON.stringify({ type: 'event.saved', eventId, userId }), { stats, now });
    const saved = put.mock.calls.find((call) => call[0] === 'event');
    expect(
      saved?.[2]?.some((m: { key: string; add?: number }) => m.key === 'numSaved' && m.add === 1),
    ).toBe(true);
    expect(saved?.[2]?.some((m: { key: string }) => m.key.startsWith('numSaved-w'))).toBe(true);

    put.mockClear();
    await processMessage(JSON.stringify({ type: 'event.unsaved', eventId, userId }), {
      stats,
      now,
    });
    const unsaved = put.mock.calls.find((call) => call[0] === 'event');
    expect(
      unsaved?.[2]?.some(
        (m: { key: string; remove?: number }) => m.key === 'numSaved' && m.remove === 1,
      ),
    ).toBe(true);

    put.mockClear();
    await processMessage(JSON.stringify({ type: 'event.coming', eventId, userId }), { stats, now });
    const interested = put.mock.calls.find((call) => call[0] === 'event');
    expect(
      interested?.[2]?.some(
        (m: { key: string; add?: number }) => m.key === 'numComing' && m.add === 1,
      ),
    ).toBe(true);

    put.mockClear();
    await processMessage(JSON.stringify({ type: 'event.coming_cleared', eventId, userId }), {
      stats,
      now,
    });
    const cleared = put.mock.calls.find((call) => call[0] === 'event');
    expect(
      cleared?.[2]?.some(
        (m: { key: string; remove?: number }) => m.key === 'numComing' && m.remove === 1,
      ),
    ).toBe(true);
  });
});

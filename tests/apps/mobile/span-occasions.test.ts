import { describe, expect, it } from 'vitest';

import { shownWhen, upcomingSpanOccasions } from '../../../apps/mobile/src/lib/span-occasions';

const now = new Date('2026-07-02T12:00:00.000Z');

describe('upcomingSpanOccasions', () => {
  it('keeps occasions that have not ended, in stored order', () => {
    const occasions = [
      { startsAt: '2026-07-01T08:00:00.000Z', endsAt: '2026-07-01T16:00:00.000Z' },
      { startsAt: '2026-07-02T08:00:00.000Z', endsAt: '2026-07-02T16:00:00.000Z' },
      { startsAt: '2026-07-03T08:00:00.000Z' },
    ];
    expect(upcomingSpanOccasions(occasions, now)).toEqual([occasions[1], occasions[2]]);
  });

  it('returns nothing when the event has no folded occasions', () => {
    expect(upcomingSpanOccasions(undefined, now)).toEqual([]);
    expect(upcomingSpanOccasions([], now)).toEqual([]);
  });
});

describe('shownWhen', () => {
  const event = {
    startsAt: '2026-06-01T08:00:00.000Z',
    endsAt: '2026-08-01T16:00:00.000Z',
    meta: {
      occasions: [
        { startsAt: '2026-06-01T08:00:00.000Z', endsAt: '2026-06-01T16:00:00.000Z' },
        { startsAt: '2026-07-02T09:00:00.000Z', endsAt: '2026-07-02T15:00:00.000Z' },
        { startsAt: '2026-07-03T09:00:00.000Z', endsAt: '2026-07-03T15:00:00.000Z' },
      ],
    },
  };

  it('uses the next occasion that has not ended', () => {
    expect(shownWhen(event, now)).toEqual({
      startsAt: '2026-07-02T09:00:00.000Z',
      endsAt: '2026-07-02T15:00:00.000Z',
    });
  });

  it('uses the event itself when it has no folded occasions', () => {
    expect(shownWhen({ startsAt: event.startsAt, endsAt: event.endsAt }, now)).toEqual({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    });
  });
});

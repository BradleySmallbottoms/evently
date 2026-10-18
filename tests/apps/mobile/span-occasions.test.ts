import { describe, expect, it } from 'vitest';

import { shownClock } from '../../../apps/mobile/src/lib/event-format';
import { shownWhen, upcomingSpanOccasions } from '../../../apps/mobile/src/lib/span-occasions';

const now = new Date('2026-07-02T12:00:00.000Z');

describe('shownClock', () => {
  it('uses the whole-day label when the start and end are the same instant', () => {
    expect(
      shownClock('2026-10-18T00:00:00+02:00', '2026-10-18T00:00:00+02:00', 'sv', 'Heldag'),
    ).toBe('Heldag');
  });

  it('uses the start time when the event has a range', () => {
    const label = shownClock(
      '2026-10-18T08:00:00+02:00',
      '2026-10-18T16:00:00+02:00',
      'sv',
      'Heldag',
    );
    expect(label).not.toBe('Heldag');
    expect(label).toMatch(/10:00|08:00/);
  });
});

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

  it('keeps a whole-day occasion through the end of its calendar day', () => {
    const afternoon = new Date('2026-10-18T17:34:00.000Z');
    const today = '2026-10-18T00:00:00+02:00';
    const tomorrowStart = '2026-10-19T09:00:00+02:00';
    const span = {
      startsAt: '2026-10-01T00:00:00+02:00',
      endsAt: '2026-10-31T00:00:00+02:00',
      timezone: 'Europe/Stockholm',
      meta: {
        occasions: [
          { startsAt: '2026-10-17T00:00:00+02:00', endsAt: '2026-10-17T00:00:00+02:00' },
          { startsAt: today, endsAt: today },
          { startsAt: tomorrowStart, endsAt: '2026-10-19T15:00:00+02:00' },
        ],
      },
    };
    expect(shownWhen(span, afternoon)).toEqual({ startsAt: today, endsAt: today });
    expect(upcomingSpanOccasions(span.meta.occasions, afternoon, span.timezone)).toEqual([
      span.meta.occasions[1],
      span.meta.occasions[2],
    ]);
  });
});

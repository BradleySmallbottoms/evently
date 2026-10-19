import { describe, expect, it } from 'vitest';
import { collapseOccasionSpan } from '../../../packages/domain/src/collapse-occasions';

const host = {
  startsAt: '2026-08-02T16:00:00.000Z',
  endsAt: '2026-08-02T18:00:00.000Z',
  venueName: 'Stora scen',
  location: { lat: 61.3, lng: 17.05 },
};

describe('collapseOccasionSpan', () => {
  it('uses the earliest start and the latest end', () => {
    const span = collapseOccasionSpan(host, [
      {
        startsAt: '2026-08-01T10:00:00.000Z',
        endsAt: '2026-08-01T12:00:00.000Z',
        venueName: 'Parken',
        location: null,
      },
      {
        startsAt: '2026-08-04T19:00:00.000Z',
        endsAt: '2026-08-04T21:00:00.000Z',
        venueName: null,
        location: { lat: 61.31, lng: 17.06 },
      },
    ]);
    expect(span?.startsAt).toBe('2026-08-01T10:00:00.000Z');
    expect(span?.endsAt).toBe('2026-08-04T21:00:00.000Z');
    expect(span?.occasions.map((occasion) => occasion.startsAt)).toEqual([
      '2026-08-01T10:00:00.000Z',
      '2026-08-02T16:00:00.000Z',
      '2026-08-04T19:00:00.000Z',
    ]);
    expect(span?.occasions[1]).toMatchObject({
      venueName: 'Stora scen',
      location: { lat: 61.3, lng: 17.05 },
    });
    expect(span?.occasions[2]).not.toHaveProperty('venueName');
  });

  it('keeps occasions already stored on the host', () => {
    const span = collapseOccasionSpan(
      {
        ...host,
        occasions: [
          { startsAt: '2026-07-01T10:00:00.000Z', endsAt: '2026-07-01T12:00:00.000Z' },
          { startsAt: '2026-07-02T10:00:00.000Z', endsAt: '2026-07-02T12:00:00.000Z' },
        ],
      },
      [
        {
          startsAt: '2026-07-03T10:00:00.000Z',
          endsAt: '2026-07-03T11:00:00.000Z',
          venueName: 'Torget',
          location: null,
        },
      ],
    );
    expect(span?.occasions).toHaveLength(3);
    expect(span?.startsAt).toBe('2026-07-01T10:00:00.000Z');
    expect(span?.endsAt).toBe('2026-07-03T11:00:00.000Z');
  });

  it('refuses an empty selection', () => {
    expect(collapseOccasionSpan(host, [])).toBeNull();
  });
});

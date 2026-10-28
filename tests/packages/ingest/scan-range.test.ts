import { describe, expect, it } from 'vitest';
import {
  readScanInstructions,
  readScanOccasions,
  readScanRange,
} from '../../../packages/ingest/src/tag-match';

describe('readScanInstructions', () => {
  it('keeps visitor steps and drops tip-field confirmations', () => {
    expect(
      readScanInstructions([
        ' Ta med matsäck ',
        '',
        'Bekräfta platsen (place) för eventet',
        'Bekräfta länken (link) till eventet',
        'Bekräfta beskrivningen (description), särskilt tiderna',
        'Anmäl dig i förväg',
      ]),
    ).toEqual(['Ta med matsäck', 'Anmäl dig i förväg']);
  });
});

describe('readScanRange', () => {
  it('keeps both instants when the end is not before the start', () => {
    expect(
      readScanRange({
        startsAt: '2026-11-14T19:00:00+01:00',
        endsAt: '2026-11-14T21:00:00+01:00',
      }),
    ).toEqual({
      startsAt: '2026-11-14T18:00:00.000Z',
      endsAt: '2026-11-14T20:00:00.000Z',
    });
  });

  it('reads a bare date as a Stockholm day', () => {
    const range = readScanRange({ startsAt: '2026-11-14', endsAt: '2026-11-14' });
    expect(range?.startsAt).toBe('2026-11-14T00:00:00+01:00');
    expect(range?.endsAt).toBe('2026-11-14T23:59:59+01:00');
  });

  it('returns null when either side is missing or the end is earlier', () => {
    expect(readScanRange({ startsAt: '2026-11-14T19:00:00+01:00', endsAt: null })).toBeNull();
    expect(readScanRange({ startsAt: null, endsAt: null })).toBeNull();
    expect(
      readScanRange({
        startsAt: '2026-11-14T21:00:00+01:00',
        endsAt: '2026-11-14T19:00:00+01:00',
      }),
    ).toBeNull();
  });
});

describe('readScanOccasions', () => {
  it('keeps each showing and drops a duplicate time and a one-sided row', () => {
    expect(
      readScanOccasions({
        possibleOccasions: [
          {
            startsAt: '2026-11-14T19:00:00+01:00',
            endsAt: '2026-11-14T21:00:00+01:00',
            venueName: ' Bygdegården ',
          },
          {
            startsAt: '2026-11-21T19:00:00+01:00',
            endsAt: '2026-11-21T20:30:00+01:00',
          },
          {
            startsAt: '2026-11-14T19:00:00+01:00',
            endsAt: '2026-11-14T21:00:00+01:00',
            venueName: 'Again',
          },
          { startsAt: '2026-11-28T19:00:00+01:00' },
        ],
      }),
    ).toEqual([
      {
        startsAt: '2026-11-14T18:00:00.000Z',
        endsAt: '2026-11-14T20:00:00.000Z',
        venueName: 'Bygdegården',
      },
      {
        startsAt: '2026-11-21T18:00:00.000Z',
        endsAt: '2026-11-21T19:30:00.000Z',
      },
    ]);
  });

  it('reads one showing from an older payload that has no array', () => {
    expect(
      readScanOccasions({
        startsAt: '2026-11-14T19:00:00+01:00',
        endsAt: '2026-11-14T21:00:00+01:00',
      }),
    ).toEqual([
      {
        startsAt: '2026-11-14T18:00:00.000Z',
        endsAt: '2026-11-14T20:00:00.000Z',
      },
    ]);
    expect(
      readScanOccasions({
        possibleOccasions: [],
        startsAt: '2026-11-14T19:00:00+01:00',
        endsAt: '2026-11-14T21:00:00+01:00',
      }),
    ).toEqual([]);
  });
});

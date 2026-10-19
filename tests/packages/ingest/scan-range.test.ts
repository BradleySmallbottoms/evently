import { describe, expect, it } from 'vitest';
import { readScanRange } from '../../../packages/ingest/src/tag-match';

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

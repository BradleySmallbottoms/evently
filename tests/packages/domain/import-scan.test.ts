import { describe, expect, it } from 'vitest';
import {
  choosePossibleOccasionGroupId,
  occasionsToAdd,
  statusAfterImportScan,
  occasionVenueOnImport,
  venueNameFromScan,
} from '../../../packages/domain/src/import-scan';

describe('statusAfterImportScan', () => {
  const ready = {
    approved: true,
    publisherStatus: 'published' as const,
    publisherIsTemporary: false,
    sourceTrust: 'auto_publish' as const,
    possibleDuplicate: false,
  };

  it('publishes a verified publisher on an auto-publish source', () => {
    expect(statusAfterImportScan(ready)).toBe('published');
  });

  it('keeps a publisher that is not published in review', () => {
    expect(statusAfterImportScan({ ...ready, publisherStatus: 'in_review' })).toBe('in_review');
    expect(statusAfterImportScan({ ...ready, publisherStatus: 'pending_scan' })).toBe('in_review');
  });

  it('keeps a temporary publisher in review', () => {
    expect(statusAfterImportScan({ ...ready, publisherIsTemporary: true })).toBe('in_review');
  });

  it('keeps a review-trust source in review', () => {
    expect(statusAfterImportScan({ ...ready, sourceTrust: 'review' })).toBe('in_review');
  });

  it('keeps a possible duplicate in review', () => {
    expect(statusAfterImportScan({ ...ready, possibleDuplicate: true })).toBe('in_review');
  });

  it('keeps an unapproved event in review', () => {
    expect(statusAfterImportScan({ ...ready, approved: false })).toBe('in_review');
  });
});

describe('choosePossibleOccasionGroupId', () => {
  const fresh = '44444444-4444-4444-8444-444444444444';

  it('creates an id when neither side has one', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: {},
        duplicates: [{ occasionRank: 91 }],
        newId: fresh,
      }),
    ).toBe(fresh);
  });

  it('reuses the scanned event group id', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: { possibleOccasionGroupId: 'cbis:1' },
        duplicates: [{ occasionRank: 95, possibleOccasionGroupId: 'cbis:2' }],
        newId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe('cbis:1');
  });

  it('reuses a duplicate group id, then an existing scanned group', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: {},
        duplicates: [
          { occasionRank: 91, possibleOccasionGroupId: 'cbis:low' },
          { occasionRank: 99, possibleOccasionGroupId: 'cbis:high' },
        ],
        newId: fresh,
      }),
    ).toBe('cbis:high');
    expect(
      choosePossibleOccasionGroupId({
        event: { possibleOccasionGroupId: fresh },
        duplicates: [{ occasionRank: 95 }],
        newId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe(fresh);
  });

  it('leaves the group alone when no duplicate ranks over 90', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: { possibleOccasionGroupId: 'cbis:1' },
        duplicates: [{ occasionRank: 90, possibleOccasionGroupId: 'cbis:2' }],
        newId: fresh,
      }),
    ).toBeNull();
  });
});

describe('venueNameFromScan', () => {
  it('uses the highest rank above 80 ahead of an imported name', () => {
    expect(
      venueNameFromScan(
        [
          { name: 'Folkets hus', rank: 81 },
          { name: 'Svea Bio', rank: 96 },
          { name: 'Torget', rank: 80 },
        ],
        { arenaName: 'Helsingehus', venueName: 'Hudiksvall' },
      ),
    ).toBe('Svea Bio');
  });

  it('uses the arena name when no rank is above 80', () => {
    expect(
      venueNameFromScan([{ name: 'Torget', rank: 80 }], {
        arenaName: 'Helsingehus',
        venueName: 'Hudiksvall',
      }),
    ).toBe('Helsingehus');
  });

  it('uses the imported venue when there is no arena', () => {
    expect(venueNameFromScan(undefined, { venueName: 'Hudiksvall' })).toBe('Hudiksvall');
    expect(venueNameFromScan([], { arenaName: '  ', venueName: '   ' })).toBeUndefined();
  });
});

describe('occasionsToAdd', () => {
  const first = {
    startsAt: new Date('2026-11-14T18:00:00.000Z'),
    endsAt: new Date('2026-11-14T20:00:00.000Z'),
    venueName: 'Bygdegården',
  };
  const second = {
    startsAt: new Date('2026-11-21T18:00:00.000Z'),
    endsAt: new Date('2026-11-21T19:30:00.000Z'),
    venueName: null,
  };

  it('adds every showing when the event has none, and skips a repeated time', () => {
    expect(occasionsToAdd([], [first, second, first])).toEqual([first, second]);
  });

  it('adds only a showing that is not already stored', () => {
    expect(occasionsToAdd([first], [first, second])).toEqual([second]);
    expect(occasionsToAdd([first], [first])).toEqual([]);
  });
});

describe('occasionVenueOnImport', () => {
  it('keeps the name the scan wrote when a later import sends another', () => {
    expect(
      occasionVenueOnImport({
        scanned: true,
        incoming: 'Hudiksvall',
        previousForKey: 'Glysis ishall',
        previousAny: 'Glysis ishall',
      }),
    ).toBe('Glysis ishall');
  });

  it('gives a new showing the venue already stored on the event', () => {
    expect(
      occasionVenueOnImport({
        scanned: true,
        incoming: 'Hudiksvall',
        previousForKey: null,
        previousAny: 'Glysis ishall',
      }),
    ).toBe('Glysis ishall');
  });

  it('uses the incoming name when a scanned event has no venue yet', () => {
    expect(
      occasionVenueOnImport({
        scanned: true,
        incoming: 'Helsingehus',
        previousForKey: null,
        previousAny: null,
      }),
    ).toBe('Helsingehus');
  });

  it('uses the incoming showing name before the scan', () => {
    expect(
      occasionVenueOnImport({
        scanned: false,
        incoming: 'Helsingehus',
        previousForKey: null,
        previousAny: null,
      }),
    ).toBe('Helsingehus');
    expect(
      occasionVenueOnImport({
        scanned: false,
        incoming: null,
        previousForKey: null,
        previousAny: null,
      }),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  choosePossibleOccasionGroupId,
  statusAfterImportScan,
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

  it('reuses the scanned event product id', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: { occasionGroupId: 'cbis:1' },
        duplicates: [
          { occasionRank: 95, occasionGroupId: 'cbis:2', possibleOccasionGroupId: fresh },
        ],
        newId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe('cbis:1');
  });

  it('reuses a duplicate product id, then an existing scan group', () => {
    expect(
      choosePossibleOccasionGroupId({
        event: {},
        duplicates: [
          { occasionRank: 91, occasionGroupId: 'cbis:low' },
          { occasionRank: 99, occasionGroupId: 'cbis:high' },
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
        event: { occasionGroupId: 'cbis:1' },
        duplicates: [{ occasionRank: 90, occasionGroupId: 'cbis:2' }],
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

import { describe, expect, it } from 'vitest';
import {
  eventsAreDuplicatePair,
  hideMergedDuplicates,
  metaWithoutFoldedDuplicate,
} from '../../../packages/domain/src/merge-duplicates';

const hostId = '44444444-4444-4444-8444-444444444401';
const matchId = '44444444-4444-4444-8444-444444444402';
const incomingId = '44444444-4444-4444-8444-444444444403';

describe('metaWithoutFoldedDuplicate', () => {
  it('drops a note that points at a folded event and keeps every other key', () => {
    const meta = {
      freeEntry: true,
      possibleDuplicate: { eventId: matchId },
      possibleOccasionGroupId: 'product-1',
    };
    expect(metaWithoutFoldedDuplicate(meta, new Set([matchId]))).toEqual({
      freeEntry: true,
      possibleOccasionGroupId: 'product-1',
    });
    expect(metaWithoutFoldedDuplicate(meta, new Set([incomingId]))).toBe(meta);
  });
});

describe('hideMergedDuplicates', () => {
  it('clears the warning when the pointed-at event is hidden and records the merge', () => {
    const result = hideMergedDuplicates({
      target: {
        id: hostId,
        title: 'Host',
        meta: {
          freeEntry: true,
          possibleDuplicate: { eventId: matchId },
        },
      },
      duplicates: [
        {
          id: matchId,
          title: 'Match',
          meta: { possibleDuplicate: { eventId: '55555555-5555-4555-8555-555555555501' } },
        },
      ],
    });
    expect(result.targetMeta).toEqual({
      freeEntry: true,
      mergedDuplicates: [{ eventId: matchId, title: 'Match' }],
    });
    expect(result.duplicates).toEqual([
      {
        id: matchId,
        meta: { duplicateOf: { eventId: hostId, title: 'Host' } },
      },
    ]);
  });

  it('keeps a warning that points at an event still open', () => {
    const warning = { eventId: matchId };
    const result = hideMergedDuplicates({
      target: {
        id: hostId,
        title: 'Host',
        meta: {
          possibleDuplicate: warning,
          mergedDuplicates: [{ eventId: matchId, title: 'Match' }],
        },
      },
      duplicates: [
        {
          id: incomingId,
          title: 'Incoming',
          meta: { possibleDuplicate: { eventId: hostId }, city: 'Söderhamn' },
        },
      ],
    });
    expect(result.targetMeta.possibleDuplicate).toEqual(warning);
    expect(result.targetMeta.mergedDuplicates).toEqual([
      { eventId: matchId, title: 'Match' },
      { eventId: incomingId, title: 'Incoming' },
    ]);
    expect(result.duplicates[0]?.meta).toEqual({
      city: 'Söderhamn',
      duplicateOf: { eventId: hostId, title: 'Host' },
    });
  });

  it('treats either direction as a duplicate pair', () => {
    expect(
      eventsAreDuplicatePair({ id: hostId, possibleDuplicateEventId: matchId }, { id: matchId }),
    ).toBe(true);
    expect(
      eventsAreDuplicatePair({ id: hostId }, { id: incomingId, possibleDuplicateEventId: hostId }),
    ).toBe(true);
    expect(eventsAreDuplicatePair({ id: hostId }, { id: matchId })).toBe(false);
    expect(
      eventsAreDuplicatePair(
        { id: hostId, possibleDuplicateEventId: matchId },
        { id: hostId, possibleDuplicateEventId: matchId },
      ),
    ).toBe(false);
  });
});

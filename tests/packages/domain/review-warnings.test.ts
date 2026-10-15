import { reviewWarnings } from '../../../packages/domain/src/review-warnings';
import { describe, expect, it } from 'vitest';

describe('reviewWarnings', () => {
  it('flags a possible duplicate', () => {
    expect(
      reviewWarnings({
        possibleDuplicate: {
          eventId: '55555555-5555-4555-8555-555555555501',
          title: 'Existing concert',
          matchedOn: 'title',
        },
      }),
    ).toEqual([
      {
        code: 'possible_duplicate',
        eventId: '55555555-5555-4555-8555-555555555501',
        title: 'Existing concert',
        matchedOn: 'title',
      },
    ]);
  });

  it('stays empty when nothing is off', () => {
    expect(reviewWarnings({})).toEqual([]);
  });
});

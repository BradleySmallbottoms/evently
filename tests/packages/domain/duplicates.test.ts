import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_RADIUS_M,
  duplicateSignal,
  stockholmCalendarDate,
} from '../../../packages/domain/src/duplicates';

describe('duplicateSignal', () => {
  it('requires the same date and a point within 500 m', () => {
    expect(
      duplicateSignal({
        distanceM: DUPLICATE_RADIUS_M,
        sameDate: true,
        titleSimilarity: 1,
        sharedLink: false,
        sameId: false,
      }),
    ).toBe('title');
    expect(
      duplicateSignal({
        distanceM: DUPLICATE_RADIUS_M + 1,
        sameDate: true,
        titleSimilarity: 1,
        sharedLink: true,
        sameId: true,
      }),
    ).toBeNull();
    expect(
      duplicateSignal({
        distanceM: 10,
        sameDate: false,
        titleSimilarity: 1,
        sharedLink: true,
        sameId: true,
      }),
    ).toBeNull();
  });

  it('prefers an id, then a link, then a title', () => {
    expect(
      duplicateSignal({
        distanceM: 20,
        sameDate: true,
        titleSimilarity: 0.2,
        sharedLink: false,
        sameId: true,
      }),
    ).toBe('id');
    expect(
      duplicateSignal({
        distanceM: 20,
        sameDate: true,
        titleSimilarity: 0.9,
        sharedLink: true,
        sameId: false,
      }),
    ).toBe('link');
  });
});

describe('stockholmCalendarDate', () => {
  it('uses the Stockholm date rather than UTC', () => {
    expect(stockholmCalendarDate(new Date('2025-01-31T23:30:00+01:00'))).toBe('2025-01-31');
    expect(stockholmCalendarDate(new Date('2025-01-31T23:30:00Z'))).toBe('2025-02-01');
  });
});

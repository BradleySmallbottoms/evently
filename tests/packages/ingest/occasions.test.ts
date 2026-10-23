import { describe, expect, it } from 'vitest';
import {
  occasionCollapseFromConfig,
  shouldCollapseOccasions,
  withCollapsedSpan,
  withOccasionGroup,
} from '../../../packages/ingest/src/occasions';

function days(count: number, step = 1): { day: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 1 + index * step));
    return { day: date.toISOString().slice(0, 10) };
  });
}

describe('occasion collapse', () => {
  it('keeps the defaults when config omits both knobs', () => {
    expect(occasionCollapseFromConfig(undefined)).toEqual({ spanDays: 21, coverage: 0.6 });
    expect(occasionCollapseFromConfig({})).toEqual({ spanDays: 21, coverage: 0.6 });
  });

  it('reads span days and coverage from source config', () => {
    expect(occasionCollapseFromConfig({ occasionSpanDays: 10, occasionCoverage: 0.8 })).toEqual({
      spanDays: 10,
      coverage: 0.8,
    });
  });

  it('rejects a coverage written as a percent', () => {
    expect(() => occasionCollapseFromConfig({ occasionCoverage: 60 })).toThrow(/fraction/);
  });

  it('collapses a dense run longer than the span and keeps a shorter or sparse one', () => {
    expect(shouldCollapseOccasions(days(22))).toBe(false);
    expect(shouldCollapseOccasions(days(23))).toBe(true);
    expect(shouldCollapseOccasions([...days(23)].reverse())).toBe(true);
    expect(shouldCollapseOccasions(days(8, 7))).toBe(false);
    expect(shouldCollapseOccasions(days(23), { spanDays: 40, coverage: 0.6 })).toBe(false);
    expect(shouldCollapseOccasions(days(8, 7), { spanDays: 21, coverage: 0 })).toBe(true);
    const doubled = days(16, 3).flatMap((occasion) => [occasion, occasion]);
    expect(shouldCollapseOccasions(doubled)).toBe(false);
  });

  it('stores the product id only when several occasions stay separate', () => {
    expect(withOccasionGroup({ ageLimit: 18 }, 'cbis:1', 1)).toEqual({ ageLimit: 18 });
    expect(withOccasionGroup(undefined, 'cbis:1', 3)).toEqual(undefined);
    expect(withOccasionGroup({ freeEntry: true }, ' 1960936 ', 2)).toEqual({
      freeEntry: true,
    });
    expect(
      withCollapsedSpan({ freeEntry: true }, [
        {
          startsAt: '2026-11-13T10:00:00+01:00',
          endsAt: '2026-11-13T18:00:00+01:00',
          venueName: 'A',
        },
        { startsAt: '2026-11-14T10:00:00+01:00' },
      ]),
    ).toEqual({
      freeEntry: true,
    });
  });
});

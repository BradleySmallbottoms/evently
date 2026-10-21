import { describe, expect, it } from 'vitest';
import {
  anyLinksMatch,
  duplicateIds,
  duplicateIdsMatch,
  duplicateLinkKeys,
  duplicateLinksMatch,
  DUPLICATE_RADIUS_M,
  duplicateSignal,
  stockholmCalendarDate,
} from '../../../packages/domain/src/duplicates';

describe('duplicateSignal', () => {
  it('requires a start within 30 minutes and a point within 200 m', () => {
    expect(
      duplicateSignal({
        distanceM: DUPLICATE_RADIUS_M,
        withinWindow: true,
        titleSimilarity: 1,
        sharedEventLink: false,
        sharedLink: false,
        sameId: false,
      }),
    ).toBe('title');
    expect(
      duplicateSignal({
        distanceM: DUPLICATE_RADIUS_M + 1,
        withinWindow: true,
        titleSimilarity: 1,
        sharedEventLink: true,
        sharedLink: true,
        sameId: true,
      }),
    ).toBeNull();
    expect(
      duplicateSignal({
        distanceM: 10,
        withinWindow: false,
        titleSimilarity: 1,
        sharedEventLink: true,
        sharedLink: true,
        sameId: true,
      }),
    ).toBeNull();
  });

  it('prefers an id, then a link, then a title', () => {
    expect(
      duplicateSignal({
        distanceM: 20,
        withinWindow: true,
        titleSimilarity: 0.2,
        sharedEventLink: false,
        sharedLink: true,
        sameId: true,
      }),
    ).toBe('id');
    expect(
      duplicateSignal({
        distanceM: 20,
        withinWindow: true,
        titleSimilarity: 0.9,
        sharedEventLink: true,
        sharedLink: true,
        sameId: false,
      }),
    ).toBe('event-link');
  });
});

describe('duplicate keys', () => {
  it('treats a Citybreak product id as the same id with or without the cbis prefix', () => {
    expect(duplicateIds(['cbis:2823720:2026-10-15T19:00:00:2026-10-15T20:20:00'])).toEqual([
      'cbis:2823720:2026-10-15T19:00:00:2026-10-15T20:20:00',
      '2823720',
    ]);
    expect(
      duplicateIdsMatch(
        ['cbis:2823720:2026-10-15T19:00:00:2026-10-15T20:20:00'],
        ['2823720:2026-10-15T19:00:00:2026-10-15T20:20:00'],
      ),
    ).toBe(true);
    expect(duplicateIdsMatch(['fixture-concert@example.com'], ['2823720'])).toBe(false);
  });

  it('keeps a specific event url and drops a shop root', () => {
    expect(duplicateLinkKeys(['https://www.tickster.com/sv/event/example/'])).toEqual([
      'www.tickster.com/sv/event/example',
    ]);
    expect(duplicateLinkKeys(['https://brobergsoderhamn.ticketco.events/se/sv'])).toEqual([]);
  });

  it('matches the same host and path and ignores protocol, query, and a trailing slash', () => {
    expect(
      duplicateLinksMatch(
        ['https://www.soderhamn.se/aquarena'],
        ['https://www.soderhamn.se/aquarena/'],
      ),
    ).toBe(true);
    expect(
      duplicateLinksMatch(
        ['https://www.soderhamn.se/aquarena?utm=newsletter'],
        ['http://www.soderhamn.se/aquarena/'],
      ),
    ).toBe(true);
    expect(
      duplicateLinksMatch(
        ['https://www.tickster.com/sv/event/example'],
        ['https://www.tickster.com/sv/event/other?ref=1'],
      ),
    ).toBe(false);
  });

  it('counts a shop homepage as a shared link and leaves it out of the event link', () => {
    const shop = ['https://brobergsoderhamn.ticketco.events/se/sv'];
    expect(anyLinksMatch(shop, ['http://brobergsoderhamn.ticketco.events/se/sv/'])).toBe(true);
    expect(duplicateLinksMatch(shop, shop)).toBe(false);
    expect(
      anyLinksMatch(['https://www.soderhamn.se/aquarena'], ['https://www.soderhamn.se/badhuset']),
    ).toBe(false);
  });
});

describe('stockholmCalendarDate', () => {
  it('uses the Stockholm date rather than UTC', () => {
    expect(stockholmCalendarDate(new Date('2025-01-31T23:30:00+01:00'))).toBe('2025-01-31');
    expect(stockholmCalendarDate(new Date('2025-01-31T23:30:00Z'))).toBe('2025-02-01');
  });
});

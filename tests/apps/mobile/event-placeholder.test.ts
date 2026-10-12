import { describe, expect, it } from 'vitest';

import { eventPlaceholderKind } from '../../../apps/mobile/src/lib/event-placeholder';

describe('eventPlaceholderKind', () => {
  it('uses the concert image for music and performance tags', () => {
    expect(eventPlaceholderKind(['Musik & Underhållning', 'Konsert'])).toBe('music');
    expect(eventPlaceholderKind(['Julkonsert'])).toBe('music');
    expect(eventPlaceholderKind(['Söderhamns Kulturfestival'])).toBe('music');
  });

  it('uses the trail image for sport tags', () => {
    expect(eventPlaceholderKind(['Idrott & Tävlingar', 'Fotboll'])).toBe('workout');
    expect(eventPlaceholderKind(['Bandy & Innebandy'])).toBe('workout');
    expect(eventPlaceholderKind(['Alpint & Längdskidor'])).toBe('workout');
    expect(eventPlaceholderKind(['Vandringar'])).toBe('workout');
  });

  it('uses the auditorium image for talks', () => {
    expect(eventPlaceholderKind(['Föreläsningar & Seminarier'])).toBe('lecture');
    expect(eventPlaceholderKind(['Näringsliv'])).toBe('lecture');
  });

  it('uses the gallery image for exhibitions, theatre, and heritage', () => {
    expect(eventPlaceholderKind(['Film & Teater'])).toBe('culture');
    expect(eventPlaceholderKind(['Utställning'])).toBe('culture');
    expect(eventPlaceholderKind(['Mässor & Utställningar', 'Skapande & Hantverk'])).toBe('culture');
    expect(eventPlaceholderKind(['Hälsingegård'])).toBe('culture');
    expect(eventPlaceholderKind(['Guidning'])).toBe('culture');
  });

  it('uses the town scene when no tag matches a scene', () => {
    expect(eventPlaceholderKind(undefined)).toBe('generic');
    expect(eventPlaceholderKind([])).toBe('generic');
    expect(eventPlaceholderKind(['Sportlov', 'Barn & Familj'])).toBe('generic');
    expect(eventPlaceholderKind(['Mat & Dryck'])).toBe('generic');
  });

  it('follows tag order when an event has both a concert and a sport', () => {
    expect(eventPlaceholderKind(['Konsert', 'Fotboll'])).toBe('music');
    expect(eventPlaceholderKind(['Fotboll', 'Konsert'])).toBe('workout');
  });

  it('lets a talk win over a broader exhibition tag', () => {
    expect(eventPlaceholderKind(['Mässor & Utställningar', 'Föreläsningar & Seminarier'])).toBe(
      'lecture',
    );
  });
});

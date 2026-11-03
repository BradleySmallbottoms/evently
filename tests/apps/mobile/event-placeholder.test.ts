import { describe, expect, it } from 'vitest';

import {
  eventPlaceholderKind,
  eventPlaceholderSlot,
  placeholderSlotsByEvent,
} from '../../../apps/mobile/src/lib/event-placeholder';

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

  it('gives neighbors in one scene different pictures even when their ids match', () => {
    const slots = placeholderSlotsByEvent([
      { id: '82b904ea-72ef-44d7-90b7-0e15d23610c5', tags: ['Mässor & Utställningar'] },
      { id: '856d8d4e-9a05-412e-a634-094e89a5f645', tags: ['Mässor & Utställningar'] },
    ]);
    expect(eventPlaceholderSlot('82b904ea-72ef-44d7-90b7-0e15d23610c5', 3)).toBe(
      eventPlaceholderSlot('856d8d4e-9a05-412e-a634-094e89a5f645', 3),
    );
    expect(slots.get('82b904ea-72ef-44d7-90b7-0e15d23610c5')).toBe(0);
    expect(slots.get('856d8d4e-9a05-412e-a634-094e89a5f645')).toBe(1);
  });

  it('keeps one event on the same picture and spreads two events apart', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    expect(eventPlaceholderSlot(first, 3)).toBe(eventPlaceholderSlot(first, 3));
    expect(eventPlaceholderSlot(first, 3)).not.toBe(eventPlaceholderSlot(second, 3));
    expect(eventPlaceholderSlot(undefined, 3)).toBe(0);
    expect(eventPlaceholderSlot(first, 1)).toBe(0);
  });

  it('lets a talk win over a broader exhibition tag', () => {
    expect(eventPlaceholderKind(['Mässor & Utställningar', 'Föreläsningar & Seminarier'])).toBe(
      'lecture',
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  canOfferEventReminder,
  selectedReminderSlots,
  upcomingReminderSlots,
} from '../../../apps/mobile/src/lib/reminder-times';

const start = new Date('2026-10-20T18:00:00.000Z');

describe('upcomingReminderSlots', () => {
  it('returns the day before, the hour before, and the start when all are ahead', () => {
    const slots = upcomingReminderSlots(start, new Date('2026-10-18T12:00:00.000Z'));
    expect(slots.map((slot) => slot.slot)).toEqual(['day', 'hour', 'start']);
    expect(slots[0]?.at.toISOString()).toBe('2026-10-19T18:00:00.000Z');
    expect(slots[1]?.at.toISOString()).toBe('2026-10-20T17:00:00.000Z');
    expect(slots[2]?.at.toISOString()).toBe(start.toISOString());
  });

  it('drops slots that are already in the past', () => {
    const slots = upcomingReminderSlots(start, new Date('2026-10-20T17:30:00.000Z'));
    expect(slots.map((slot) => slot.slot)).toEqual(['start']);
  });

  it('returns nothing after the event has started', () => {
    expect(upcomingReminderSlots(start, new Date('2026-10-20T18:00:00.000Z'))).toEqual([]);
  });

  it('offers a reminder only before the start', () => {
    expect(canOfferEventReminder(start, new Date('2026-10-20T17:59:00.000Z'))).toBe(true);
    expect(canOfferEventReminder(start, new Date('2026-10-20T18:00:00.000Z'))).toBe(false);
  });

  it('keeps only the slots the user chose', () => {
    const slots = selectedReminderSlots(start, new Date('2026-10-18T12:00:00.000Z'), [
      'hour',
      'start',
    ]);
    expect(slots.map((slot) => slot.slot)).toEqual(['hour', 'start']);
  });
});

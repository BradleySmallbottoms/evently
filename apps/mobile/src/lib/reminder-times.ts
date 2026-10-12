export type ReminderSlot = 'day' | 'hour' | 'start';

/** Reminders are only offered before the event starts. */
export function canOfferEventReminder(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() > now.getTime();
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Future reminder instants relative to the event start. Past slots are omitted. */
export function upcomingReminderSlots(
  startsAt: Date,
  now: Date,
): { slot: ReminderSlot; at: Date }[] {
  const startMs = startsAt.getTime();
  const slots: { slot: ReminderSlot; at: Date }[] = [
    { slot: 'day', at: new Date(startMs - DAY_MS) },
    { slot: 'hour', at: new Date(startMs - HOUR_MS) },
    { slot: 'start', at: new Date(startMs) },
  ];
  return slots.filter((slot) => slot.at.getTime() > now.getTime());
}

/** Upcoming slots the user picked. Past times are dropped even if they were chosen. */
export function selectedReminderSlots(
  startsAt: Date,
  now: Date,
  chosen: readonly ReminderSlot[],
): { slot: ReminderSlot; at: Date }[] {
  const wanted = new Set(chosen);
  return upcomingReminderSlots(startsAt, now).filter((slot) => wanted.has(slot.slot));
}

export function reminderIdentifier(eventId: string, slot: ReminderSlot): string {
  return `le.reminder.${eventId}.${slot}`;
}

export type EventContentVisibility = 'public' | 'attendees';

/** Public items are always visible; attendee-only items require a check-in. */
export function canViewEventContent(
  visibility: EventContentVisibility,
  hasCheckIn: boolean,
): boolean {
  if (visibility === 'public') return true;
  return hasCheckIn;
}

const DEFAULT_TIME_ZONE = 'Europe/Stockholm';

type SpanOccasion = {
  startsAt: string;
  endsAt?: string;
};

/** True when the start and end are the same instant. That is a whole day. */
export function isWholeDay(startsAt: string, endsAt: string | null | undefined): boolean {
  if (!endsAt) return false;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Number.isFinite(start) && start === end;
}

function calendarDay(instant: Date, timeZone: string): string {
  const zone = timeZone || DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }
}

function occasionStillOn(occasion: SpanOccasion, now: Date, timeZone: string): boolean {
  if (isWholeDay(occasion.startsAt, occasion.endsAt)) {
    return calendarDay(new Date(occasion.startsAt), timeZone) >= calendarDay(now, timeZone);
  }
  const end = occasion.endsAt ?? occasion.startsAt;
  return new Date(end).getTime() >= now.getTime();
}

/** Occasions folded into this event that have not ended, in stored order. */
export function upcomingSpanOccasions<T extends SpanOccasion>(
  occasions: T[] | undefined,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): T[] {
  if (!occasions?.length) return [];
  return occasions.filter((occasion) => occasionStillOn(occasion, now, timeZone));
}

type DatedEvent = {
  startsAt: string;
  endsAt: string;
  timezone?: string;
  meta?: { occasions?: SpanOccasion[] } | null;
};

/**
 * Date and time to show for an event. A collapsed span uses the next occasion
 * that has not ended. A whole-day occasion lasts its calendar day. Any other
 * event uses its own start and end.
 */
export function shownWhen(event: DatedEvent, now: Date): { startsAt: string; endsAt: string } {
  const next = upcomingSpanOccasions(event.meta?.occasions, now, event.timezone)[0];
  if (!next) return { startsAt: event.startsAt, endsAt: event.endsAt };
  return { startsAt: next.startsAt, endsAt: next.endsAt ?? event.endsAt };
}

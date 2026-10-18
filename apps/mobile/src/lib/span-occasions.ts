type SpanOccasion = {
  startsAt: string;
  endsAt?: string;
};

/** Occasions folded into this event that have not ended, in stored order. */
export function upcomingSpanOccasions<T extends SpanOccasion>(
  occasions: T[] | undefined,
  now: Date,
): T[] {
  if (!occasions?.length) return [];
  const at = now.getTime();
  return occasions.filter((occasion) => {
    const end = occasion.endsAt ?? occasion.startsAt;
    return new Date(end).getTime() >= at;
  });
}

type DatedEvent = {
  startsAt: string;
  endsAt: string;
  meta?: { occasions?: SpanOccasion[] } | null;
};

/**
 * Date and time to show for an event. A collapsed span uses the next occasion
 * that has not ended. Any other event uses its own start and end.
 */
export function shownWhen(event: DatedEvent, now: Date): { startsAt: string; endsAt: string } {
  const next = upcomingSpanOccasions(event.meta?.occasions, now)[0];
  if (!next) return { startsAt: event.startsAt, endsAt: event.endsAt };
  return { startsAt: next.startsAt, endsAt: next.endsAt ?? event.endsAt };
}

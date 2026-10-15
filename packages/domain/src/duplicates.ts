/** A lookalike has to be at least this close, and on the same Stockholm calendar date. */
export const DUPLICATE_RADIUS_M = 500;

/** Trigram similarity at or above this counts as a matching title. */
export const DUPLICATE_MIN_TITLE_SIMILARITY = 0.5;

export type DuplicateSignal = 'title' | 'link' | 'id';

/** `YYYY-MM-DD` in Europe/Stockholm. */
export function stockholmCalendarDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function stockholmOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  let day = pick('day');
  let hour = pick('hour');
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, day, hour, pick('minute'), pick('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Start of the Stockholm calendar day, and the start of the next one. */
export function stockholmDayRange(instant: Date): { start: Date; end: Date } {
  const [year, month, day] = stockholmCalendarDate(instant).split('-').map(Number);
  const midnight = (date: number) => {
    const guess = Date.UTC(year!, month! - 1, date, 0, 0, 0);
    let offset = stockholmOffsetMinutes(new Date(guess));
    offset = stockholmOffsetMinutes(new Date(guess - offset * 60_000));
    return new Date(guess - offset * 60_000);
  };
  return { start: midnight(day!), end: midnight(day! + 1) };
}

/**
 * Location and date are required. Among events that pass both, an id, a shared
 * link, or a similar title is enough. Id wins over a link, and a link over a title.
 */
export function duplicateSignal(input: {
  distanceM: number | null;
  sameDate: boolean;
  titleSimilarity: number;
  sharedLink: boolean;
  sameId: boolean;
}): DuplicateSignal | null {
  if (input.distanceM == null || input.distanceM > DUPLICATE_RADIUS_M) return null;
  if (!input.sameDate) return null;
  if (input.sameId) return 'id';
  if (input.sharedLink) return 'link';
  if (input.titleSimilarity >= DUPLICATE_MIN_TITLE_SIMILARITY) return 'title';
  return null;
}

import { eventUrlKey, isSpecificTicketUrl } from './event-links';

/** A lookalike has to be at least this close, and start within 30 minutes. */
export const DUPLICATE_RADIUS_M = 200;

/** Starts further apart than this are not the same event. */
export const DUPLICATE_WINDOW_MINUTES = 30;

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

/** True when two starts are at most 30 minutes apart. */
export function withinDuplicateWindow(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= DUPLICATE_WINDOW_MINUTES * 60_000;
}

/**
 * Location and a start within 30 minutes are required. Among events that pass
 * both, an id, a shared link, or a similar title is enough. Id wins over a
 * link, and a link over a title.
 */
export function duplicateSignal(input: {
  distanceM: number | null;
  withinWindow: boolean;
  titleSimilarity: number;
  sharedLink: boolean;
  sameId: boolean;
}): DuplicateSignal | null {
  if (input.distanceM == null || input.distanceM > DUPLICATE_RADIUS_M) return null;
  if (!input.withinWindow) return null;
  if (input.sameId) return 'id';
  if (input.sharedLink) return 'link';
  if (input.titleSimilarity >= DUPLICATE_MIN_TITLE_SIMILARITY) return 'title';
  return null;
}

/** Citybreak ids are `123`, `123:occasion`, `123:span`, or `cbis:123:…`. */
const CITYBREAK_PRODUCT_ID = /^(?:cbis:)?(\d+)(?::|$)/;

/**
 * Ids every worker can share. The full source id is kept, and a Citybreak product
 * also contributes its numeric id so `cbis:123:…` and `123:…` are the same event.
 */
export function duplicateIds(values: (string | null | undefined)[]): string[] {
  const keys: string[] = [];
  const push = (value: string) => {
    if (!keys.includes(value)) keys.push(value);
  };
  for (const value of values) {
    const id = value?.trim();
    if (!id) continue;
    push(id);
    const product = CITYBREAK_PRODUCT_ID.exec(id)?.[1];
    if (product) push(product);
  }
  return keys;
}

export function duplicateIdsMatch(
  left: (string | null | undefined)[],
  right: (string | null | undefined)[],
): boolean {
  const keys = new Set(duplicateIds(left));
  return duplicateIds(right).some((id) => keys.has(id));
}

/** Specific event URLs. A shop homepage or a language-only path is left out. */
export function duplicateLinkKeys(urls: (string | null | undefined)[]): string[] {
  const keys: string[] = [];
  for (const url of urls) {
    if (!url || !isSpecificTicketUrl(url)) continue;
    const key = eventUrlKey(url);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function duplicateLinksMatch(
  left: (string | null | undefined)[],
  right: (string | null | undefined)[],
): boolean {
  const keys = new Set(duplicateLinkKeys(left));
  return duplicateLinkKeys(right).some((key) => keys.has(key));
}

/** Id beats a link, and a link beats a title. A tie keeps the nearer event. */
export function preferDuplicate(
  current: { signal: DuplicateSignal; distanceM: number } | null,
  next: { signal: DuplicateSignal; distanceM: number },
): boolean {
  if (!current) return true;
  const rank = (signal: DuplicateSignal) => (signal === 'id' ? 0 : signal === 'link' ? 1 : 2);
  const nextRank = rank(next.signal);
  const currentRank = rank(current.signal);
  return nextRank < currentRank || (nextRank === currentRank && next.distanceM < current.distanceM);
}

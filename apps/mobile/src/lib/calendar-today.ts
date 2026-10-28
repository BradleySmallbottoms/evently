import { compareStamps, partsInZone, type DayStamp } from './calendar-range';

/** How often the open calendar re-reads the Stockholm day. */
export const CALENDAR_DAY_POLL_MS = 60_000;

type Month = { y: number; m: number };
type Range = { from: DayStamp; to: DayStamp };

export function monthIndex(month: Month): number {
  return month.y * 12 + month.m;
}

/** The same stamp, or the new day when `now` has crossed midnight in Stockholm. */
export function retainCalendarDay(current: DayStamp, now: Date): DayStamp {
  const next = partsInZone(now);
  return compareStamps(current, next) === 0 ? current : next;
}

/** A month before today moves forward. A later month stays where the person left it. */
export function monthOnNewDay(month: Month, today: DayStamp): Month {
  if (monthIndex(month) < monthIndex(today)) return { y: today.y, m: today.m };
  return month;
}

/** Drop a range that has ended, and pull a start that is now in the past up to today. */
export function clampRangeToToday(range: Range | null, today: DayStamp): Range | null {
  if (!range) return null;
  if (compareStamps(range.to, today) < 0) return null;
  if (compareStamps(range.from, today) < 0) return { from: today, to: range.to };
  return range;
}

export function selectionOnNewDay(
  from: DayStamp | null,
  to: DayStamp | null,
  today: DayStamp,
): { from: DayStamp | null; to: DayStamp | null } {
  if (to != null && compareStamps(to, today) < 0) return { from: null, to: null };
  if (from != null && compareStamps(from, today) < 0) return { from: today, to };
  return { from, to };
}

type AppStateSubscription = {
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void };
};

/**
 * Read the calendar day immediately, then again on each interval and whenever
 * the app becomes active. A backgrounded timer does not fire at midnight.
 */
export function watchCalendarDay(
  notify: (today: DayStamp) => void,
  options: {
    now: () => Date;
    everyMs: number;
    appState: AppStateSubscription;
  },
): () => void {
  const publish = () => notify(partsInZone(options.now()));
  publish();
  const timer = setInterval(publish, options.everyMs);
  const subscription = options.appState.addEventListener('change', (state) => {
    if (state === 'active') publish();
  });
  return () => {
    clearInterval(timer);
    subscription.remove();
  };
}

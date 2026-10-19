export const ZONE = 'Europe/Stockholm';

/** A calendar day. `m` is 1–12. */
export type DayStamp = { y: number; m: number; d: number };

export function partsInZone(date: Date, timeZone = ZONE): DayStamp {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function zoneOffsetMs(utc: Date, timeZone: string): number {
  const stripped = new Date(utc);
  stripped.setUTCMilliseconds(0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(utc)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let day = Number(bag.day);
  let hour = Number(bag.hour);
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    day,
    hour,
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - stripped.getTime();
}

/** Start or end of that calendar day in the zone, as an absolute instant. */
export function zonedDate(stamp: DayStamp, end: boolean, timeZone = ZONE): Date {
  const guess = new Date(
    Date.UTC(
      stamp.y,
      stamp.m - 1,
      stamp.d,
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0,
    ),
  );
  const offset = zoneOffsetMs(guess, timeZone);
  const adjusted = new Date(guess.getTime() - offset);
  const offset2 = zoneOffsetMs(adjusted, timeZone);
  return offset2 === offset ? adjusted : new Date(guess.getTime() - offset2);
}

export function stampKey(stamp: DayStamp): string {
  return `${stamp.y}-${String(stamp.m).padStart(2, '0')}-${String(stamp.d).padStart(2, '0')}`;
}

export function compareStamps(a: DayStamp, b: DayStamp): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function addDays(stamp: DayStamp, days: number): DayStamp {
  const utc = new Date(Date.UTC(stamp.y, stamp.m - 1, stamp.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

export function addMonths(year: number, month: number, delta: number): { y: number; m: number } {
  const index = year * 12 + (month - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday is 0. */
export function weekdayIndex(stamp: DayStamp, timeZone = ZONE): number {
  const instant = zonedDate(stamp, false, timeZone);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[name] ?? 0;
}

export function monthStamps(year: number, month: number): { from: DayStamp; to: DayStamp } {
  return { from: { y: year, m: month, d: 1 }, to: { y: year, m: month, d: daysInMonth(year, month) } };
}

/** The Saturday–Sunday that contains `today`, or the coming weekend. */
export function weekendStamps(today: DayStamp): { from: DayStamp; to: DayStamp } {
  const weekday = weekdayIndex(today);
  const delta = weekday === 6 ? -1 : 5 - weekday;
  const saturday = addDays(today, delta);
  return { from: saturday, to: addDays(saturday, 1) };
}

export function boundsIso(from: DayStamp, to: DayStamp, timeZone = ZONE): { from: string; to: string } {
  const start = compareStamps(from, to) <= 0 ? from : to;
  const end = compareStamps(from, to) <= 0 ? to : from;
  return {
    from: zonedDate(start, false, timeZone).toISOString(),
    to: zonedDate(end, true, timeZone).toISOString(),
  };
}

export function spans(stamp: DayStamp, from: DayStamp, to: DayStamp): boolean {
  const start = compareStamps(from, to) <= 0 ? from : to;
  const end = compareStamps(from, to) <= 0 ? to : from;
  return compareStamps(stamp, start) >= 0 && compareStamps(stamp, end) <= 0;
}

/** Monday-first cells, including the leading and trailing days of neighbouring months. */
export function monthGrid(year: number, month: number): DayStamp[] {
  const first = { y: year, m: month, d: 1 };
  const lead = weekdayIndex(first);
  const cells: DayStamp[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(addDays(first, i - lead));
  const count = daysInMonth(year, month);
  for (let day = 1; day <= count; day += 1) cells.push({ y: year, m: month, d: day });
  while (cells.length % 7 !== 0) cells.push(addDays(cells[cells.length - 1]!, 1));
  return cells;
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDayShort(stamp: DayStamp, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: ZONE,
  }).format(zonedDate(stamp, false));
  return text.replace('.', '');
}

export function formatDayLong(stamp: DayStamp, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ZONE,
  }).format(zonedDate(stamp, false));
}

export function formatMonthYear(year: number, month: number, locale: string): string {
  return capitalize(
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: ZONE }).format(
      zonedDate({ y: year, m: month, d: 1 }, false),
    ),
  );
}

export function formatRangeShort(from: DayStamp, to: DayStamp, locale: string): string {
  const start = compareStamps(from, to) <= 0 ? from : to;
  const end = compareStamps(from, to) <= 0 ? to : from;
  if (compareStamps(start, end) === 0) return formatDayShort(start, locale);
  if (start.y === end.y && start.m === end.m) {
    const month = formatDayShort({ ...start, d: 1 }, locale).replace(/^\d+\s*/, '');
    return `${start.d}–${end.d} ${month}`;
  }
  return `${formatDayShort(start, locale)} – ${formatDayShort(end, locale)}`;
}

export function formatSectionTitle(stamp: DayStamp, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ZONE,
  }).format(zonedDate(stamp, false));
  return capitalize(text);
}

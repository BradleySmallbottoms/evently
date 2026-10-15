/** Minutes east of UTC for Europe/Stockholm at this instant. */
export function stockholmOffsetMinutes(instant: Date): number {
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
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    day,
    hour,
    pick('minute'),
    pick('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** A Stockholm wall clock, written as an ISO datetime with that day's offset. */
export function stockholmWallTime(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}): string {
  const second = input.second ?? 0;
  const wallUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    second,
  );
  let offset = stockholmOffsetMinutes(new Date(wallUtc));
  offset = stockholmOffsetMinutes(new Date(wallUtc - offset * 60_000));
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetHour = String(Math.floor(abs / 60)).padStart(2, '0');
  const offsetMinute = String(abs % 60).padStart(2, '0');
  const month = String(input.month).padStart(2, '0');
  const day = String(input.day).padStart(2, '0');
  const hour = String(input.hour).padStart(2, '0');
  const minute = String(input.minute).padStart(2, '0');
  const sec = String(second).padStart(2, '0');
  return `${input.year}-${month}-${day}T${hour}:${minute}:${sec}${sign}${offsetHour}:${offsetMinute}`;
}

const ABSOLUTE_TIME = /(?:[zZ]|[+-]\d{2}:\d{2})$/;
const NAIVE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A `Z` or numeric offset is that instant. A clock with no zone is Europe/Stockholm.
 * Citybreak CBIS sends `2026-10-28T15:00:00Z` as 15:00 UTC. Hälsingland and Hudiksvall
 * send a local date and period, which stay on {@link stockholmWallTime}.
 */
export function sourceDateTime(value: string): string {
  const trimmed = value.trim();
  if (ABSOLUTE_TIME.test(trimmed)) {
    const instant = new Date(trimmed);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Source time is not a datetime: ${value}`);
    }
    return instant.toISOString();
  }
  const match = NAIVE_TIME.exec(trimmed);
  if (!match) throw new Error(`Source time is not a datetime: ${value}`);
  return stockholmWallTime({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] ? Number(match[6]) : 0,
  });
}

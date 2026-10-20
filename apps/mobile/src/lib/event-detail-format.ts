const DEFAULT_TIME_ZONE = 'Europe/Stockholm';

function zone(timeZone: string | null | undefined): string {
  return timeZone?.trim() || DEFAULT_TIME_ZONE;
}

function calendarDay(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
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

function clean(value: string): string {
  return value.replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function dayMonth(
  iso: string,
  locale: string,
  timeZone: string,
  withYear: boolean,
): string {
  return clean(
    new Intl.DateTimeFormat(locale, {
      timeZone,
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' as const } : {}),
    }).format(new Date(iso)),
  );
}

/** True when the start and end fall on different calendar days. */
export function isMultiDay(
  startsAt: string,
  endsAt: string,
  timeZone?: string | null,
): boolean {
  const tz = zone(timeZone);
  return calendarDay(new Date(startsAt), tz) !== calendarDay(new Date(endsAt), tz);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A span the visitor can join on any day.
 * Crossing midnight for a few hours is still one showing, not a period.
 */
export function isOpenPeriod(
  startsAt: string,
  endsAt: string,
  timeZone?: string | null,
): boolean {
  if (!isMultiDay(startsAt, endsAt, timeZone)) return false;
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return Number.isFinite(ms) && ms >= DAY_MS;
}

export type PeriodStatus = 'now' | 'soon' | 'past';

/** Where today sits in the event's calendar span, including the end day. */
export function periodStatus(
  startsAt: string,
  endsAt: string,
  now: Date,
  timeZone?: string | null,
): PeriodStatus {
  const tz = zone(timeZone);
  const today = calendarDay(now, tz);
  const start = calendarDay(new Date(startsAt), tz);
  const end = calendarDay(new Date(endsAt), tz);
  if (today < start) return 'soon';
  if (today > end) return 'past';
  return 'now';
}

/** "19 sep – 15 nov 2026", or a single day when the span is one calendar day. */
export function formatPeriod(
  startsAt: string,
  endsAt: string,
  locale: string,
  timeZone?: string | null,
): string {
  const tz = zone(timeZone);
  const startDay = calendarDay(new Date(startsAt), tz);
  const endDay = calendarDay(new Date(endsAt), tz);
  if (startDay === endDay) return dayMonth(startsAt, locale, tz, true);
  const sameYear = startDay.slice(0, 4) === endDay.slice(0, 4);
  const start = dayMonth(startsAt, locale, tz, !sameYear);
  const end = dayMonth(endsAt, locale, tz, true);
  return `${start} – ${end}`;
}

/** "lör 19 sep 2026" */
export function formatDayHeading(iso: string, locale: string, timeZone?: string | null): string {
  const tz = zone(timeZone);
  return clean(
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso)),
  );
}

export function formatTimeRange(
  startsAt: string,
  endsAt: string,
  locale: string,
  timeZone?: string | null,
): string {
  const tz = zone(timeZone);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
  return `${time(startsAt)} – ${time(endsAt)}`;
}

/**
 * Short line under the title, and the rest for "About".
 * A short description is only the lead. A long one keeps the first sentence
 * as the lead and the remainder as the about text.
 * If a summary is provided, it is used as the lead.
 */
export function descriptionParts(
  description: string | null | undefined,
  summary?: string | null,
): {
  lead: string;
  about: string;
} {
  const trimmed = description?.trim() ?? '';
  if (!trimmed) return { lead: summary ?? '', about: '' };
  if (trimmed.length <= 180) return { lead: summary || trimmed, about: '' };
  const match = trimmed.match(/^[\s\S]*?[.!?](?:\s|$)/);
  const sentence = match?.[0]?.trim() ?? '';
  if (!sentence || sentence.length > 180) {
    return { lead: summary || `${trimmed.slice(0, 160).trimEnd()}…`, about: trimmed };
  }
  const rest = trimmed.slice(sentence.length).trim();
  if (!rest) return { lead: summary || trimmed, about: '' };
  return { lead: summary || sentence, about: rest };
}

/** Hostname for a "more information" link, without a leading www. */
export function linkHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

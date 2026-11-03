import { shortDateLabel } from './event-format';

const ZONE = 'Europe/Stockholm';

export type NotificationGroupId = 'today' | 'yesterday' | 'earlier';

export type NotificationPresentation =
  | 'tip_published'
  | 'tip_approved'
  | 'tip_needs_input'
  | 'tip_failed'
  | 'new_event'
  | 'event_updated'
  | 'broadcast';

export function notificationPresentation(item: {
  reason: string;
  tipStatus?: string | null;
}): NotificationPresentation {
  if (item.reason === 'tip') {
    if (item.tipStatus === 'published') return 'tip_published';
    if (item.tipStatus === 'needs_input') return 'tip_needs_input';
    if (item.tipStatus === 'failed') return 'tip_failed';
    return 'tip_approved';
  }
  if (item.reason === 'nearby' || item.reason === 'publisher') return 'new_event';
  if (item.reason === 'event') return 'event_updated';
  return 'broadcast';
}

export type NotificationWhen =
  | { kind: 'now' }
  | { kind: 'minutes'; count: number }
  | { kind: 'today'; time: string }
  | { kind: 'yesterday'; time: string }
  | { kind: 'earlier'; date: string; time: string };

function calendarDay(instant: Date, timeZone: string): string {
  const zone = timeZone || ZONE;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }
}

function clock(instant: Date, timeZone: string): string {
  const zone = timeZone || ZONE;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: ZONE,
    }).format(instant);
  }
}

function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) - 1));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Relative label for a row. Recent rows on the same calendar day read as minutes ago. */
export function notificationWhen(
  iso: string,
  locale: string,
  now = new Date(),
  timeZone = ZONE,
): NotificationWhen {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) return { kind: 'earlier', date: '', time: '' };
  const day = calendarDay(instant, timeZone);
  const today = calendarDay(now, timeZone);
  const time = clock(instant, timeZone);
  if (day === today) {
    const minutes = Math.floor((now.getTime() - instant.getTime()) / 60_000);
    if (minutes < 1) return { kind: 'now' };
    if (minutes < 60) return { kind: 'minutes', count: minutes };
    return { kind: 'today', time };
  }
  if (day === previousDay(today)) return { kind: 'yesterday', time };
  return { kind: 'earlier', date: shortDateLabel(iso, locale, timeZone), time };
}

export function notificationGroup(
  iso: string,
  now = new Date(),
  timeZone = ZONE,
): NotificationGroupId {
  const when = notificationWhen(iso, 'sv', now, timeZone);
  if (when.kind === 'yesterday') return 'yesterday';
  if (when.kind === 'earlier') return 'earlier';
  return 'today';
}

/** Today, then yesterday, then earlier. Order inside a group stays as given. */
export function groupNotifications<T extends { createdAt: string }>(
  items: readonly T[],
  now = new Date(),
  timeZone = ZONE,
): { id: NotificationGroupId; items: T[] }[] {
  const buckets = new Map<NotificationGroupId, T[]>();
  for (const item of items) {
    const id = notificationGroup(item.createdAt, now, timeZone);
    const list = buckets.get(id);
    if (list) list.push(item);
    else buckets.set(id, [item]);
  }
  return (['today', 'yesterday', 'earlier'] as const)
    .filter((id) => buckets.has(id))
    .map((id) => ({ id, items: buckets.get(id) ?? [] }));
}

export function notificationText(
  item: {
    titleSv: string | null;
    titleEn: string | null;
    bodySv: string | null;
    bodyEn: string | null;
  },
  locale: 'sv' | 'en',
): { title: string; message: string } {
  const title = (locale === 'en' ? item.titleEn : item.titleSv)?.trim() ?? '';
  const message = (locale === 'en' ? item.bodyEn : item.bodySv)?.trim() ?? '';
  return { title, message };
}

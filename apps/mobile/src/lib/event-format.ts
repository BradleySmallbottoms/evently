import { selectPrimaryLink, type PrimaryEventAction } from '@local-events/domain';

import { isWholeDay } from './span-occasions';

const DEFAULT_TIME_ZONE = 'Europe/Stockholm';

export type EventLink = {
  type: 'tickets' | 'registration' | 'info' | 'facebook' | 'instagram';
  url: string;
  label?: string | null;
};

export function dateBadge(iso: string, locale: string, timeZone?: string) {
  const date = new Date(iso);
  const withoutPeriod = (value: string) => value.replace(/\./g, '').trim();
  const zone = timeZone ? { timeZone } : {};
  return {
    weekday: withoutPeriod(date.toLocaleDateString(locale, { weekday: 'short', ...zone })),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', ...zone }).format(date),
    month: withoutPeriod(date.toLocaleDateString(locale, { month: 'short', ...zone })),
  };
}

/** Start time next to a venue. A whole day uses the translated label. */
export function shownClock(
  startsAt: string,
  endsAt: string,
  locale: string,
  wholeDayLabel: string,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (isWholeDay(startsAt, endsAt)) return wholeDayLabel;
  return new Date(startsAt).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** Same rule as the web event page: only http(s) is safe to open. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    return null;
  }
  return null;
}

export function primaryAction(
  links: EventLink[],
  onlineUrl: string | null | undefined,
): PrimaryEventAction | null {
  const safeLinks = links.filter((link) => safeHttpUrl(link.url));
  return selectPrimaryLink(safeLinks, safeHttpUrl(onlineUrl));
}

/** First safe tickets URL. Registration and info links are left out. */
export function ticketLink(
  links: readonly EventLink[],
): { url: string; label: string | null } | null {
  const found = participateSheetLinks(links, null).tickets[0];
  if (!found) return null;
  return { url: found.url, label: found.label };
}

export type ParticipateLink = {
  type: EventLink['type'] | 'online';
  url: string;
  label: string | null;
};

/** Safe tickets links, then the event's other links, including the online page. */
export function participateSheetLinks(
  links: readonly EventLink[],
  onlineUrl: string | null | undefined,
): { tickets: ParticipateLink[]; event: ParticipateLink[] } {
  const tickets: ParticipateLink[] = [];
  const event: ParticipateLink[] = [];
  for (const link of links) {
    const url = safeHttpUrl(link.url);
    if (!url) continue;
    const item = { type: link.type, url, label: link.label ?? null };
    if (link.type === 'tickets') tickets.push(item);
    else event.push(item);
  }
  const online = safeHttpUrl(onlineUrl);
  if (online) event.push({ type: 'online', url: online, label: null });
  return { tickets, event };
}

export function isThisWeekend(iso: string, now = new Date()): boolean {
  const date = new Date(iso);
  const day = now.getDay();
  const friday = new Date(now);
  friday.setDate(now.getDate() + ((5 - day + 7) % 7));
  friday.setHours(0, 0, 0, 0);
  const monday = new Date(friday);
  monday.setDate(friday.getDate() + 3);
  return date >= friday && date < monday;
}

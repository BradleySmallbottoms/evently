import { selectPrimaryLink, type PrimaryEventAction } from '@local-events/domain';

import { isWholeDay } from './span-occasions';

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
): string {
  if (isWholeDay(startsAt, endsAt)) return wholeDayLabel;
  return new Date(startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
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
  for (const link of links) {
    if (link.type !== 'tickets') continue;
    const url = safeHttpUrl(link.url);
    if (url) return { url, label: link.label ?? null };
  }
  return null;
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

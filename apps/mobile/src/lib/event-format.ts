import {
  priceAmountFromText,
  selectPrimaryLink,
  type PrimaryEventAction,
} from '@local-events/domain';

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

const TICKET_SHOP = /tickster|nortic|ticketco/;

type TicketCandidate = {
  url: string;
  label?: string | null;
  title?: string | null;
  detail?: string | null;
};

/** A link states its own price, or it is a ticket shop when the event has one. */
function ticketOffersPrice(link: TicketCandidate, priceLabel?: string | null): boolean {
  const written = priceAmountFromText(`${link.label ?? ''} ${link.title ?? ''}`);
  if (written != null && written > 0) return true;
  if (!priceLabel) return false;
  return TICKET_SHOP.test(`${link.detail ?? ''} ${link.url}`.toLowerCase());
}

/**
 * Ticket link to show. One that carries a price stays ahead of the others.
 * Order is otherwise unchanged.
 */
export function featuredTicketLink<T extends TicketCandidate>(
  links: readonly T[],
  priceLabel?: string | null,
): T | undefined {
  if (links.length === 0) return undefined;
  return [...links].sort(
    (a, b) => Number(ticketOffersPrice(b, priceLabel)) - Number(ticketOffersPrice(a, priceLabel)),
  )[0];
}

/** Ticket link for the event page. Registration and info links are left out. */
export function ticketLink(
  links: readonly EventLink[],
  priceLabel?: string | null,
): { url: string; label: string | null } | null {
  const found = featuredTicketLink(participateSheetLinks(links, null).tickets, priceLabel);
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

import { selectPrimaryLink, type PrimaryEventAction } from '@local-events/domain';

export type EventLink = {
  type: 'tickets' | 'registration' | 'info';
  url: string;
  label?: string | null;
};

export function formatPrice(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
  freeLabel: string,
): string | null {
  if (amount == null) return null;
  if (amount === 0) return freeLabel;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SEK',
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency || 'SEK'}`;
  }
}

export function dateBadge(iso: string, locale: string) {
  const date = new Date(iso);
  const withoutPeriod = (value: string) => value.replace(/\./g, '').trim();
  return {
    weekday: withoutPeriod(date.toLocaleDateString(locale, { weekday: 'short' })),
    day: String(date.getDate()),
    month: withoutPeriod(date.toLocaleDateString(locale, { month: 'short' })),
  };
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

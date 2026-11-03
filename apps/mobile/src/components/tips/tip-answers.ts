import { bareTipLink } from '@local-events/domain';

import type { DayStamp } from '@/lib/calendar-range';

export function parseLink(answer: string | null): { url: string } {
  const line = answer?.trim() ?? '';
  if (/^link:\s*none$/i.test(line)) return { url: '' };
  const url = line.match(/^link:\s*(\S+)$/i);
  return { url: url?.[1] ? (bareTipLink(url[1]) ?? '') : '' };
}

export function replyMatches(reply: string, answer: string | null): boolean {
  const left = reply.trim().toLowerCase();
  const right = answer?.trim().toLowerCase() ?? '';
  if (left === right) return true;
  const bare = bareTipLink(right.replace(/^link:\s*/i, ''));
  const expected = bareTipLink(left.replace(/^link:\s*/i, ''));
  return Boolean(bare && expected && bare === expected);
}

export function parsePrice(answer: string | null): {
  choice: 'free' | 'paid' | null;
  amount: string;
} {
  const line = answer?.trim() ?? '';
  if (/^price:\s*free$/i.test(line)) return { choice: 'free', amount: '' };
  const price = line.match(/^price:\s*(\d{1,6}(?:[.,]\d{1,2})?)$/i);
  if (price?.[1]) return { choice: 'paid', amount: price[1] };
  return { choice: null, amount: '' };
}

export function parseEnd(answer: string | null): { date: DayStamp | null; time: string } {
  const line = answer?.trim() ?? '';
  if (/^end:\s*none$/i.test(line)) return { date: null, time: '' };
  const rest = line.replace(/^end:\s*/i, '');
  const both = rest.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (both) {
    return {
      date: { y: Number(both[1]), m: Number(both[2]), d: Number(both[3]) },
      time: both[4] ?? '',
    };
  }
  const clock = rest.match(/^(\d{2}:\d{2})$/);
  return { date: null, time: clock?.[1] ?? '' };
}

export function endLabel(value: string, locale: string): string {
  const clock = value.match(/^(\d{2}:\d{2})$/);
  if (clock) return clock[1]!;
  const both = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!both) return value;
  const when = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Number(both[1]), Number(both[2]) - 1, Number(both[3])));
  return both[4] ? `${when} ${both[4]}` : when;
}

export function parseClock(answer: string | null): string {
  const match = answer?.trim().match(/^(?:startTime|endTime|end):\s*([01]\d:[0-5]\d)$/i);
  return match?.[1] ?? '';
}

export function parseDate(answer: string | null): DayStamp | null {
  const match = answer?.trim().match(/^(?:date|startDate|endDate|end):\s*(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

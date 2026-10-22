import type { EventMode } from './types';

export type EventFieldsInput = {
  mode: EventMode;
  location: { lat: number; lng: number } | null | undefined;
  onlineUrl: string | null | undefined;
};

/**
 * Digital events need an online URL. A physical event may omit its point.
 * Without a point it stays off the map and does not match nearby push.
 * Used on create, update and before publish.
 */
export function validateEventFields(
  input: EventFieldsInput,
): { ok: true } | { ok: false; reason: 'online_url_required' } {
  if (input.mode === 'digital' && !input.onlineUrl) {
    return { ok: false, reason: 'online_url_required' };
  }
  return { ok: true };
}

/**
 * The public event list includes an event only when it has a point inside the
 * search radius. Tags do not replace a missing point. Direct lookup by id is
 * unchanged.
 */
export function isPubliclyListedEvent(input: { hasLocation: boolean }): boolean {
  return input.hasLocation;
}

const DEFAULT_TIME_ZONE = 'Europe/Stockholm';

function zoneName(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim();
  return trimmed || DEFAULT_TIME_ZONE;
}

function calendarDay(instant: Date, timeZone: string): string {
  const zone = zoneName(timeZone);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
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

/**
 * Whether a public list should still show this event.
 * A timed event stays until its end. A whole day, the same start and end,
 * stays through that calendar day. `from` raises the lower bound.
 */
export function eventIsCurrent(input: {
  startsAt: Date;
  endsAt: Date;
  timeZone?: string | null;
  now: Date;
  from?: Date;
}): boolean {
  const tz = zoneName(input.timeZone);
  if (input.startsAt.getTime() === input.endsAt.getTime()) {
    const day = calendarDay(input.startsAt, tz);
    if (day < calendarDay(input.now, tz)) return false;
    if (input.from && day < calendarDay(input.from, tz)) return false;
    return Number.isFinite(input.startsAt.getTime());
  }
  const lower = input.from && input.from.getTime() > input.now.getTime() ? input.from : input.now;
  return input.endsAt.getTime() >= lower.getTime();
}

export function canEditEvent(status: string): boolean {
  return status === 'draft' || status === 'awaiting_verification' || status === 'published';
}

export function canPublishEvent(status: string): boolean {
  return status === 'draft' || status === 'awaiting_verification';
}

/** Admin approval of an imported event waiting in the review queue. */
export function canApproveImportedEvent(status: string): boolean {
  return status === 'in_review';
}

/** Admin rejection of an imported event in the review queue. */
export function canRejectImportedEvent(status: string): boolean {
  return status === 'in_review';
}

/** An imported review or published event can go back to the import scan. */
export function canRescanImportedEvent(input: { status: string; origin: string }): boolean {
  return (
    input.origin === 'imported' && (input.status === 'in_review' || input.status === 'published')
  );
}

/**
 * An imported event still in review can be soft-deleted or wiped.
 * Soft delete cancels it and leaves the row. Wipe removes the row.
 */
export function canDeleteImportedEvent(input: { status: string; origin: string }): boolean {
  return input.status === 'in_review' && input.origin === 'imported';
}

export const MAX_EVENT_LISTS = 20;
export const MAX_EVENTS_PER_LIST = 100;
export const MAX_EVENT_LINKS = 10;

export type EventLinkKind = 'tickets' | 'registration' | 'info' | 'facebook' | 'instagram';

export type PrimaryEventAction =
  | { kind: EventLinkKind; url: string; label: string | null }
  | { kind: 'online'; url: string; label: null };

/**
 * Detail CTA: first tickets link, then registration, then the digital event URL,
 * then info, then a Facebook or Instagram page.
 */
export function selectPrimaryLink(
  links: { type: EventLinkKind; url: string; label?: string | null }[],
  onlineUrl: string | null | undefined,
): PrimaryEventAction | null {
  for (const type of ['tickets', 'registration'] as const) {
    const found = links.find((link) => link.type === type);
    if (found) return { kind: type, url: found.url, label: found.label ?? null };
  }
  if (onlineUrl) return { kind: 'online', url: onlineUrl, label: null };
  for (const type of ['info', 'facebook', 'instagram'] as const) {
    const found = links.find((link) => link.type === type);
    if (found) return { kind: type, url: found.url, label: found.label ?? null };
  }
  return null;
}

export function canCreateAnotherList(currentCount: number): boolean {
  return currentCount < MAX_EVENT_LISTS;
}

export function canAddListItem(currentCount: number): boolean {
  return currentCount < MAX_EVENTS_PER_LIST;
}

/**
 * Lifetime saves plus "I'm coming" marks. Someone who did both counts twice.
 * `sort=popular` uses this, and drops events below 1.
 */
export function eventEngagement(numSaved: number, numComing: number): number {
  return numSaved + numComing;
}

export function isPopularEvent(numSaved: number, numComing: number): boolean {
  return eventEngagement(numSaved, numComing) >= 1;
}

export function canCancelEvent(status: string): boolean {
  return (
    status === 'draft' ||
    status === 'awaiting_verification' ||
    status === 'published' ||
    status === 'in_review'
  );
}

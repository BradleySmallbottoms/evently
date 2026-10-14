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
 * The public event list includes an event that has a point, or at least one tag.
 * An event with neither is omitted. A point still has to fall inside the search
 * radius. Direct lookup by id is unchanged, and an event without a point stays
 * off the map.
 */
export function isPubliclyListedEvent(input: { hasLocation: boolean; tagCount: number }): boolean {
  return input.hasLocation || input.tagCount > 0;
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

export const MAX_EVENT_LISTS = 20;
export const MAX_EVENTS_PER_LIST = 100;
export const MAX_EVENT_LINKS = 10;

export type EventLinkKind = 'tickets' | 'registration' | 'info';

export type PrimaryEventAction =
  | { kind: 'tickets' | 'registration' | 'info'; url: string; label: string | null }
  | { kind: 'online'; url: string; label: null };

/**
 * Detail CTA: first tickets link, then registration, then the digital event URL, then info.
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
  const info = links.find((link) => link.type === 'info');
  if (info) return { kind: 'info', url: info.url, label: info.label ?? null };
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

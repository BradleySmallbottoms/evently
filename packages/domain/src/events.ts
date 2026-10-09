import type { EventMode } from './types';

export type EventFieldsInput = {
  mode: EventMode;
  location: { lat: number; lng: number } | null | undefined;
  onlineUrl: string | null | undefined;
};

/**
 * Physical events need a location; digital events need an online URL.
 * Used on create, update and before publish.
 */
export function validateEventFields(
  input: EventFieldsInput,
): { ok: true } | { ok: false; reason: 'location_required' | 'online_url_required' } {
  if (input.mode === 'physical') {
    if (!input.location) return { ok: false, reason: 'location_required' };
    return { ok: true };
  }
  if (!input.onlineUrl) return { ok: false, reason: 'online_url_required' };
  return { ok: true };
}

export function canEditEvent(status: string): boolean {
  return status === 'draft' || status === 'awaiting_verification' || status === 'published';
}

export function canPublishEvent(status: string): boolean {
  return status === 'draft' || status === 'awaiting_verification';
}

export function canCancelEvent(status: string): boolean {
  return (
    status === 'draft' ||
    status === 'awaiting_verification' ||
    status === 'published' ||
    status === 'in_review'
  );
}

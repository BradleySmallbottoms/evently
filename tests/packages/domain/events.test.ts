import { describe, expect, it } from 'vitest';
import {
  canCancelEvent,
  canDeleteImportedEvent,
  canEditEvent,
  canPublishEvent,
  isPubliclyListedEvent,
  validateEventFields,
} from '../../../packages/domain/src/events';

describe('validateEventFields', () => {
  it('allows a physical event without a location', () => {
    expect(validateEventFields({ mode: 'physical', location: null, onlineUrl: null })).toEqual({
      ok: true,
    });
    expect(
      validateEventFields({
        mode: 'physical',
        location: { lat: 61.3, lng: 17.0 },
        onlineUrl: null,
      }),
    ).toEqual({ ok: true });
  });

  it('requires onlineUrl for digital events', () => {
    expect(validateEventFields({ mode: 'digital', location: null, onlineUrl: null })).toEqual({
      ok: false,
      reason: 'online_url_required',
    });
    expect(
      validateEventFields({
        mode: 'digital',
        location: null,
        onlineUrl: 'https://example.com/live',
      }),
    ).toEqual({ ok: true });
  });
});

describe('isPubliclyListedEvent', () => {
  it('requires a point', () => {
    expect(isPubliclyListedEvent({ hasLocation: false })).toBe(false);
    expect(isPubliclyListedEvent({ hasLocation: true })).toBe(true);
  });
});

describe('event status gates', () => {
  it('allows edit/publish/cancel for expected statuses', () => {
    expect(canEditEvent('draft')).toBe(true);
    expect(canEditEvent('cancelled')).toBe(false);
    expect(canPublishEvent('draft')).toBe(true);
    expect(canPublishEvent('published')).toBe(false);
    expect(canCancelEvent('published')).toBe(true);
    expect(canCancelEvent('ended')).toBe(false);
    expect(canDeleteImportedEvent({ status: 'in_review', origin: 'imported' })).toBe(true);
    expect(canDeleteImportedEvent({ status: 'published', origin: 'imported' })).toBe(false);
    expect(canDeleteImportedEvent({ status: 'in_review', origin: 'native' })).toBe(false);
  });
});

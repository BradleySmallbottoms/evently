import { describe, expect, it } from 'vitest';
import {
  canCancelEvent,
  canDeleteImportedEvent,
  canRescanImportedEvent,
  canEditEvent,
  canPublishEvent,
  eventIsCurrent,
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

describe('eventIsCurrent', () => {
  const now = new Date('2026-10-18T21:00:00.000Z');

  it('drops a timed event after it ends', () => {
    expect(
      eventIsCurrent({
        startsAt: new Date('2026-10-18T15:00:00.000Z'),
        endsAt: new Date('2026-10-18T17:00:00.000Z'),
        timeZone: 'Europe/Stockholm',
        now,
      }),
    ).toBe(false);
  });

  it('keeps a timed event that is still on', () => {
    expect(
      eventIsCurrent({
        startsAt: new Date('2026-10-18T20:00:00.000Z'),
        endsAt: new Date('2026-10-18T22:00:00.000Z'),
        timeZone: 'Europe/Stockholm',
        now,
      }),
    ).toBe(true);
  });

  it('keeps a whole day through that calendar day', () => {
    expect(
      eventIsCurrent({
        startsAt: new Date('2026-10-18T07:00:00.000Z'),
        endsAt: new Date('2026-10-18T07:00:00.000Z'),
        timeZone: 'Europe/Stockholm',
        now,
      }),
    ).toBe(true);
    expect(
      eventIsCurrent({
        startsAt: new Date('2026-10-17T07:00:00.000Z'),
        endsAt: new Date('2026-10-17T07:00:00.000Z'),
        timeZone: 'Europe/Stockholm',
        now,
      }),
    ).toBe(false);
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
    expect(canRescanImportedEvent({ status: 'in_review', origin: 'imported' })).toBe(true);
    expect(canRescanImportedEvent({ status: 'published', origin: 'imported' })).toBe(true);
    expect(canRescanImportedEvent({ status: 'published', origin: 'native' })).toBe(false);
    expect(canRescanImportedEvent({ status: 'pending_scan', origin: 'imported' })).toBe(false);
    expect(canRescanImportedEvent({ status: 'cancelled', origin: 'imported' })).toBe(false);
    expect(canRescanImportedEvent({ status: 'in_review', origin: 'native' })).toBe(false);
  });
});

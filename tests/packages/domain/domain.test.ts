import { describe, expect, it } from 'vitest';
import {
  canComment,
  canRate,
  releaseOnVerification,
  shouldSuggestRegion,
  statusOnPublish,
  validateGeoCheckIn,
} from '../../../packages/domain/src/index';

const start = new Date('2026-11-01T18:00:00Z');
const end = new Date('2026-11-01T21:00:00Z');
const venue = { lat: 61.3037, lng: 17.0592 };

describe('validateGeoCheckIn', () => {
  const base = {
    event: { startsAt: start, endsAt: end, geofenceCenter: venue, geofenceRadiusM: 100 },
    location: venue,
    accuracyM: 20,
    alreadyCheckedIn: false,
    now: new Date('2026-11-01T17:45:00Z'),
  };
  it('accepts inside the window and geofence', () => {
    expect(validateGeoCheckIn(base)).toEqual({ ok: true });
  });
  it('rejects before the window opens', () => {
    expect(validateGeoCheckIn({ ...base, now: new Date('2026-11-01T17:00:00Z') })).toMatchObject({
      reason: 'outside_window',
    });
  });
  it('rejects poor accuracy', () => {
    expect(validateGeoCheckIn({ ...base, accuracyM: 250 })).toMatchObject({
      reason: 'poor_accuracy',
    });
  });
});

describe('ratings', () => {
  it('allows rating only after the event, within 14 days, with a check-in', () => {
    const ctx = { hasCheckIn: true, alreadyRated: false, isOwnEvent: false, eventEndsAt: end };
    expect(canRate({ ...ctx, now: new Date('2026-11-01T20:00:00Z') })).toBe(false);
    expect(canRate({ ...ctx, now: new Date('2026-11-02T10:00:00Z') })).toBe(true);
    expect(canRate({ ...ctx, now: new Date('2026-11-20T10:00:00Z') })).toBe(false);
    expect(canRate({ ...ctx, hasCheckIn: false, now: new Date('2026-11-02T10:00:00Z') })).toBe(
      false,
    );
  });
  it('blocks comments from anonymous users', () => {
    expect(canComment({ displayName: null, isPublic: false })).toBe(false);
    expect(canComment({ displayName: 'Mia', isPublic: true })).toBe(true);
  });
});

describe('publishing', () => {
  it('hides events from unverified publishers', () => {
    expect(statusOnPublish({ origin: 'native', publisherVerified: false })).toBe(
      'awaiting_verification',
    );
    expect(statusOnPublish({ origin: 'native', publisherVerified: true })).toBe('published');
  });
  it('routes imported events by source trust', () => {
    expect(
      statusOnPublish({
        origin: 'imported',
        sourceTrust: 'auto_publish',
        publisherIsTemporary: false,
      }),
    ).toBe('published');
    expect(
      statusOnPublish({
        origin: 'imported',
        sourceTrust: 'auto_publish',
        publisherIsTemporary: true,
      }),
    ).toBe('in_review');
  });
  it('releases only upcoming events on verification', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(releaseOnVerification({ status: 'awaiting_verification', endsAt: end }, now)).toBe(
      'published',
    );
    expect(
      releaseOnVerification(
        { status: 'awaiting_verification', endsAt: new Date('2026-10-01T00:00:00Z') },
        now,
      ),
    ).toBe('awaiting_verification');
  });
});

describe('shouldSuggestRegion', () => {
  const hudiksvall = { lat: 61.729, lng: 17.1036 };
  const base = {
    location: hudiksvall,
    savedAreas: [{ center: venue, radiusM: 10_000 }],
    foregroundSeconds: 90,
    screensOpened: 1,
    isCheckingIn: false,
    lastPromptAt: null,
    declines: [],
    now: new Date('2026-11-01T12:00:00Z'),
  };
  it('suggests when far from saved areas and actively used', () => {
    expect(shouldSuggestRegion(base)).toBe(true);
  });
  it('does not suggest near a saved area', () => {
    expect(shouldSuggestRegion({ ...base, location: venue })).toBe(false);
  });
  it('respects a recent decline', () => {
    const declines = [
      { center: hudiksvall, at: new Date('2026-10-15T00:00:00Z'), permanent: false },
    ];
    expect(shouldSuggestRegion({ ...base, declines })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canComment,
  canRate,
  releaseOnVerification,
  resolveTravelDistanceM,
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

describe('profile', () => {
  it('resolves named and anonymous choices', async () => {
    const { resolveProfileChoice, normalizeRecoveryEmail } = await import(
      '../../../packages/domain/src/profile'
    );
    expect(resolveProfileChoice({ choice: 'anonymous' })).toEqual({
      ok: true,
      displayName: null,
      isPublic: false,
    });
    expect(
      resolveProfileChoice({ choice: 'named', displayName: '  Mia  Sund  ' }),
    ).toEqual({ ok: true, displayName: 'Mia Sund', isPublic: true });
    expect(resolveProfileChoice({ choice: 'named', displayName: 'x' }).ok).toBe(false);
    expect(normalizeRecoveryEmail('  Mia@Example.com ')).toBe('mia@example.com');
    expect(normalizeRecoveryEmail('')).toBe(null);
  });
});

describe('event content', () => {
  it('gates attendee visibility on check-in', async () => {
    const { canViewEventContent } = await import(
      '../../../packages/domain/src/event-content'
    );
    expect(canViewEventContent('public', false)).toBe(true);
    expect(canViewEventContent('attendees', false)).toBe(false);
    expect(canViewEventContent('attendees', true)).toBe(true);
  });
});

describe('stats', () => {
  it('averages scores to one decimal', async () => {
    const { averageFromScores, roundRatingAverage, ratingAverage } = await import(
      '../../../packages/domain/src/stats'
    );
    expect(averageFromScores([])).toBe(null);
    expect(averageFromScores([5, 4])).toBe(4.5);
    expect(roundRatingAverage(4.66)).toBe(4.7);
    expect(ratingAverage(2, 9)).toBe(4.5);
  });

  it('builds calendar bucket keys', async () => {
    const { bucketKeys, applyStatMutation } = await import(
      '../../../packages/domain/src/stats'
    );
    const keys = bucketKeys('numCheckins', new Date('2026-01-07T12:00:00.000Z'), 'UTC');
    expect(keys).toEqual([
      'numCheckins',
      'numCheckins-2026-01-07',
      'numCheckins-w02',
      'numCheckins-2026-m01',
      'numCheckins-2026',
    ]);
    expect(applyStatMutation(1, { key: 'x', remove: 3 })).toBe(-2);
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

  it('asks on open when the user has no saved region', () => {
    expect(
      shouldSuggestRegion({
        ...base,
        savedAreas: [],
        foregroundSeconds: 0,
        screensOpened: 0,
      }),
    ).toBe(true);
  });

  it('waits a week after a dismiss near that place, and asks again well outside it', () => {
    const here = hudiksvall;
    const dismissed = {
      center: here,
      at: new Date('2026-10-28T12:00:00Z'),
      permanent: false,
    };
    const noAreas = {
      ...base,
      location: here,
      savedAreas: [],
      foregroundSeconds: 0,
      screensOpened: 0,
    };
    expect(shouldSuggestRegion({ ...noAreas, declines: [dismissed] })).toBe(false);
    expect(
      shouldSuggestRegion({
        ...noAreas,
        lastPromptAt: new Date('2026-11-01T06:00:00Z'),
        declines: [dismissed],
      }),
    ).toBe(false);
    expect(
      shouldSuggestRegion({
        ...noAreas,
        declines: [{ ...dismissed, at: new Date('2026-10-20T12:00:00Z') }],
      }),
    ).toBe(true);
    // Stockholm is far outside Hudiksvall. The 7-day dismiss and the same-day cap stay behind.
    expect(
      shouldSuggestRegion({
        ...noAreas,
        location: { lat: 59.33, lng: 18.07 },
        lastPromptAt: new Date('2026-11-01T06:00:00Z'),
        declines: [dismissed],
      }),
    ).toBe(true);
  });

  it('snaps travel distance to 1 km, then every 5 km', () => {
    expect(resolveTravelDistanceM(null)).toBe(25_000);
    expect(resolveTravelDistanceM(500)).toBe(1_000);
    expect(resolveTravelDistanceM(3_000)).toBe(5_000);
    expect(resolveTravelDistanceM(12_400)).toBe(10_000);
    expect(resolveTravelDistanceM(25_000)).toBe(25_000);
    expect(resolveTravelDistanceM(250_000)).toBe(100_000);
  });

  it('uses the profile travel distance', () => {
    expect(shouldSuggestRegion({ ...base, travelDistanceM: 50_000 })).toBe(false);
    expect(shouldSuggestRegion({ ...base, travelDistanceM: 10_000 })).toBe(true);
  });
});

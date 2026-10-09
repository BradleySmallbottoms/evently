import { describe, expect, it } from 'vitest';
import {
  canSendUnderDailyCap,
  DAILY_NOTIFICATION_CAP,
  eventNotificationCopy,
  interestsOverlap,
  isWithinQuietHours,
  localDayKey,
  localMinutesOfDay,
  shouldPresentOsNotification,
} from '../../../packages/domain/src/notifications';

describe('interestsOverlap', () => {
  it('requires non-empty overlap', () => {
    expect(interestsOverlap([], ['a'])).toBe(false);
    expect(interestsOverlap(['a'], [])).toBe(false);
    expect(interestsOverlap(['a', 'b'], ['c'])).toBe(false);
    expect(interestsOverlap(['a', 'b'], ['b', 'c'])).toBe(true);
  });
});

describe('canSendUnderDailyCap', () => {
  it('allows up to the cap', () => {
    expect(canSendUnderDailyCap(0)).toBe(true);
    expect(canSendUnderDailyCap(DAILY_NOTIFICATION_CAP - 1)).toBe(true);
    expect(canSendUnderDailyCap(DAILY_NOTIFICATION_CAP)).toBe(false);
  });
});

describe('quiet hours', () => {
  const prefs = {
    enabled: true,
    timezone: 'Europe/Stockholm',
    startMin: 22 * 60,
    endMin: 8 * 60,
  };

  it('is quiet late evening and early morning in Stockholm', () => {
    // 2026-06-15 21:30 UTC = 23:30 CEST
    expect(isWithinQuietHours(new Date('2026-06-15T21:30:00.000Z'), prefs)).toBe(true);
    // 2026-06-15 05:00 UTC = 07:00 CEST
    expect(isWithinQuietHours(new Date('2026-06-15T05:00:00.000Z'), prefs)).toBe(true);
  });

  it('is not quiet mid-afternoon in Stockholm', () => {
    // 2026-06-15 12:00 UTC = 14:00 CEST
    expect(isWithinQuietHours(new Date('2026-06-15T12:00:00.000Z'), prefs)).toBe(false);
  });

  it('respects enabled=false', () => {
    expect(
      isWithinQuietHours(new Date('2026-06-15T21:30:00.000Z'), {
        ...prefs,
        enabled: false,
      }),
    ).toBe(false);
  });

  it('computes local minutes', () => {
    // 12:00 UTC → 14:00 CEST in June
    expect(localMinutesOfDay(new Date('2026-06-15T12:00:00.000Z'), 'Europe/Stockholm')).toBe(
      14 * 60,
    );
  });

  it('buckets by local day', () => {
    // 2026-06-15 22:30 UTC = 2026-06-16 00:30 CEST
    expect(localDayKey(new Date('2026-06-15T22:30:00.000Z'), 'Europe/Stockholm')).toBe(
      '2026-06-16',
    );
  });
});

describe('shouldPresentOsNotification', () => {
  const quietHours = {
    enabled: true,
    timezone: 'Europe/Stockholm',
    startMin: 22 * 60,
    endMin: 8 * 60,
  };

  it('presents when backgrounded, outside quiet hours, under cap', () => {
    expect(
      shouldPresentOsNotification({
        now: new Date('2026-06-15T12:00:00.000Z'),
        quietHours,
        presentedToday: 0,
        appInForeground: false,
      }),
    ).toBe(true);
  });

  it('skips in foreground, quiet hours, or over cap', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    expect(
      shouldPresentOsNotification({
        now,
        quietHours,
        presentedToday: 0,
        appInForeground: true,
      }),
    ).toBe(false);
    expect(
      shouldPresentOsNotification({
        now: new Date('2026-06-15T21:30:00.000Z'),
        quietHours,
        presentedToday: 0,
        appInForeground: false,
      }),
    ).toBe(false);
    expect(
      shouldPresentOsNotification({
        now,
        quietHours,
        presentedToday: DAILY_NOTIFICATION_CAP,
        appInForeground: false,
      }),
    ).toBe(false);
  });
});

describe('eventNotificationCopy', () => {
  it('localizes body by reason', () => {
    expect(eventNotificationCopy('en', 'Gig', 'nearby').body).toMatch(/near you/i);
    expect(eventNotificationCopy('sv', 'Gig', 'publisher').body).toMatch(/arrangör/i);
  });
});

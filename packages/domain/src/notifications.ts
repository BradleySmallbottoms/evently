/** Max local OS notifications the app may present per user per local calendar day. */
export const DAILY_NOTIFICATION_CAP = 5;

/** Inbox rows older than this are hard-deleted by the worker (storage hygiene). */
export const NOTIFICATION_RETENTION_DAYS = 90;

export const DEFAULT_NOTIFICATION_TIMEZONE = 'Europe/Stockholm';

/**
 * Local quiet window 22:00–08:00 (wraps midnight).
 * Enforced on the client when deciding whether to present an OS notification.
 * Inbox storage and silent Expo delivery are not gated by quiet hours.
 */
export const DEFAULT_QUIET_HOURS = {
  startMin: 22 * 60,
  endMin: 8 * 60,
} as const;

export type QuietHoursPrefs = {
  enabled: boolean;
  /** IANA timezone, e.g. Europe/Stockholm. */
  timezone: string;
  /** Minutes from local midnight [0, 1440). */
  startMin: number;
  /** Minutes from local midnight [0, 1440). */
  endMin: number;
};

export type NotificationReason = 'nearby' | 'publisher' | 'event' | 'broadcast';

/**
 * Empty interests mean the user has not opted into any tag — no nearby pushes.
 * Otherwise at least one event tag must overlap.
 */
export function interestsOverlap(
  userCategoryIds: readonly string[],
  eventCategoryIds: readonly string[],
): boolean {
  if (userCategoryIds.length === 0 || eventCategoryIds.length === 0) return false;
  const wanted = new Set(userCategoryIds);
  return eventCategoryIds.some((id) => wanted.has(id));
}

export function canSendUnderDailyCap(
  presentedToday: number,
  cap: number = DAILY_NOTIFICATION_CAP,
): boolean {
  return presentedToday < cap;
}

/** Local minutes-from-midnight for `now` in `timezone`. Falls back to UTC on bad TZ. */
export function localMinutesOfDay(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * True when `now` falls inside the local quiet window.
 * When startMin >= endMin the window wraps midnight (e.g. 22:00–08:00).
 */
export function isWithinQuietHours(now: Date, prefs: QuietHoursPrefs): boolean {
  if (!prefs.enabled) return false;
  const m = localMinutesOfDay(now, prefs.timezone || DEFAULT_NOTIFICATION_TIMEZONE);
  const start = prefs.startMin;
  const end = prefs.endMin;
  if (start === end) return true; // full-day quiet
  if (start < end) return m >= start && m < end;
  return m >= start || m < end;
}

/** Local calendar day key (YYYY-MM-DD) for daily-cap bucketing. */
export function localDayKey(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || DEFAULT_NOTIFICATION_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Whether the mobile app should post a local OS notification after a silent push.
 * Cap + quiet hours are client-only; foreground skips the OS notification (badge/inbox only).
 */
export function shouldPresentOsNotification(input: {
  now: Date;
  quietHours: QuietHoursPrefs;
  presentedToday: number;
  appInForeground: boolean;
  cap?: number;
}): boolean {
  if (input.appInForeground) return false;
  if (isWithinQuietHours(input.now, input.quietHours)) return false;
  if (!canSendUnderDailyCap(input.presentedToday, input.cap)) return false;
  return true;
}

/** Copy for a client-presented local OS notification. */
export function eventNotificationCopy(
  locale: string,
  title: string,
  reason: NotificationReason,
): { title: string; body: string } {
  if (locale.startsWith('en')) {
    return {
      title,
      body:
        reason === 'publisher'
          ? 'A followed publisher posted a new event'
          : reason === 'event'
            ? 'An event you follow was updated'
            : reason === 'broadcast'
              ? 'A message from Local Events'
              : 'A new event near you',
    };
  }
  return {
    title,
    body:
      reason === 'publisher'
        ? 'En följd arrangör publicerade ett evenemang'
        : reason === 'event'
          ? 'Ett evenemang du följer uppdaterades'
          : reason === 'broadcast'
            ? 'Ett meddelande från Local Events'
            : 'Ett nytt evenemang nära dig',
  };
}

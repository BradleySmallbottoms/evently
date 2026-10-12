const DEFAULT_DEV_WEB_URL = 'http://localhost:3100';

function parseOrigin(raw: string): string | null {
  try {
    return new URL(raw.trim().replace(/\/$/, '')).origin;
  } catch {
    return null;
  }
}

/**
 * Public web origin for shareable event links.
 * Falls back to local web only in development; production requires EXPO_PUBLIC_WEB_URL.
 */
export function webBaseUrl(envUrl = process.env.EXPO_PUBLIC_WEB_URL): string {
  const fromEnv = envUrl ? parseOrigin(envUrl) : null;
  if (fromEnv) return fromEnv;
  const isDev =
    typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (isDev) return DEFAULT_DEV_WEB_URL;
  throw new Error('EXPO_PUBLIC_WEB_URL is not configured');
}

/**
 * HTTPS (or local http) URL for the public event page.
 * Path matches Expo Router `/events/[id]` so Universal Links open the detail screen.
 * Web uses `localePrefix: 'as-needed'`, so the default locale has no prefix.
 */
export function buildEventWebUrl(
  eventId: string,
  envUrl = process.env.EXPO_PUBLIC_WEB_URL,
): string {
  return `${webBaseUrl(envUrl)}/events/${encodeURIComponent(eventId)}`;
}

/**
 * One text item for the share sheet.
 * iOS Copy, Messenger, and Facebook keep the first text item and drop a
 * separate URL, so the link has to live in this string.
 */
export function eventShareMessage(title: string, url: string): string {
  const trimmed = title.trim();
  return trimmed ? `${trimmed}\n${url}` : url;
}

import { buildEventWebUrl } from './event-share-url';
import { safeHttpUrl } from './event-format';

export type FacebookShareTarget = 'dialog' | 'browser';

/**
 * Link attached to the Facebook post.
 * A ticket link comes first, then the event's own page, then the web app.
 */
export function facebookPostUrl(input: {
  links: readonly { type: string; url: string }[];
  webAppUrl: string | null;
}): string | null {
  for (const type of ['tickets', 'info'] as const) {
    for (const link of input.links) {
      if (link.type !== type) continue;
      const url = safeHttpUrl(link.url);
      if (url) return url;
    }
  }
  return input.webAppUrl ? safeHttpUrl(input.webAppUrl) : null;
}

/**
 * Link for a Facebook post, a Messenger message, and the system share sheet.
 * Copy link stays on the web app URL.
 */
export function eventOutboundUrl(input: {
  eventId: string;
  links: readonly { type: string; url: string }[];
}): string {
  let webAppUrl: string | null = null;
  try {
    webAppUrl = buildEventWebUrl(input.eventId);
  } catch {
    webAppUrl = null;
  }
  const url = facebookPostUrl({ links: input.links, webAppUrl });
  if (!url) throw new Error('EXPO_PUBLIC_WEB_URL is not configured');
  return url;
}

/**
 * The native dialog needs a rebuilt app with a numeric Facebook app id and a
 * client token. Web, and a build that does not have those, stays on the
 * browser sharer.
 */
export function facebookShareTarget(input: {
  appId?: string;
  clientToken?: string;
  platform: 'ios' | 'android' | 'web';
}): FacebookShareTarget {
  if (input.platform === 'web') return 'browser';
  const appId = input.appId?.trim() ?? '';
  const clientToken = input.clientToken?.trim() ?? '';
  if (!/^\d+$/.test(appId) || clientToken.length === 0) return 'browser';
  return 'dialog';
}

/** Browser fallback. This page uses the browser's Facebook session. */
export function facebookWebSharerUrl(eventUrl: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl)}`;
}

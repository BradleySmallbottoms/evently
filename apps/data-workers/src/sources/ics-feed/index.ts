import { organizerKeys, stockholmWallTime } from '@local-events/domain';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';

/**
 * Generic ICS/iCal feed adapter. Config: `{ "feedUrl": "https://…/calendar.ics" }`.
 * Parses VEVENT records (SUMMARY, DTSTART, DTEND, UID, LOCATION, URL, DESCRIPTION,
 * ORGANIZER). Times without TZID are treated as Europe/Stockholm wall time.
 */

export type IcsRaw = { body: string; feedUrl: string };

type VEvent = Record<string, string>;

/** Refuse localhost / private / link-local / metadata hosts (SSRF). */
function isPublicHttpsFeedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal'
  ) {
    return false;
  }
  if (
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.')
  ) {
    return false;
  }
  if (host.startsWith('169.254.') || host.startsWith('0.')) return false;
  const second = Number(host.split('.')[1]);
  if (host.startsWith('172.') && second >= 16 && second <= 31) return false;
  if (
    host.includes(':') &&
    (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))
  ) {
    return false;
  }
  return true;
}

function feedUrlFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.feedUrl === 'string' ? config.feedUrl.trim() : '';
  if (!raw) throw new Error('ics-feed config.feedUrl is required');
  if (!isPublicHttpsFeedUrl(raw)) {
    throw new Error('ics-feed config.feedUrl must be a public https URL');
  }
  return new URL(raw).toString();
}

/** Unfold ICS lines (RFC 5545) and split into properties. */
export function unfoldIcs(body: string): string[] {
  const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

export function parseVEvents(body: string): VEvent[] {
  const lines = unfoldIcs(body);
  const events: VEvent[] = [];
  let current: VEvent | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(';')[0]?.toUpperCase() ?? '';
    if (!name) continue;
    const params = left.includes(';') ? left.slice(left.indexOf(';') + 1) : '';
    current[name] = value;
    if (params) current[`${name}_PARAMS`] = params;
  }
  return events;
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse ICS date-time into ISO-8601 with offset. Floating local → Europe/Stockholm. */
export function icsDateToIso(value: string, params = ''): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.endsWith('Z') && /^\d{8}T\d{6}Z$/.test(v)) {
    const y = v.slice(0, 4);
    const mo = v.slice(4, 6);
    const d = v.slice(6, 8);
    const h = v.slice(9, 11);
    const mi = v.slice(11, 13);
    const s = v.slice(13, 15);
    return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  }
  const dateOnly = /^\d{8}$/.test(v);
  const local = /^\d{8}T\d{6}$/.test(v);
  if (!dateOnly && !local) return null;
  void params;
  return stockholmWallTime({
    year: Number(v.slice(0, 4)),
    month: Number(v.slice(4, 6)),
    day: Number(v.slice(6, 8)),
    hour: local ? Number(v.slice(9, 11)) : 0,
    minute: local ? Number(v.slice(11, 13)) : 0,
    second: local ? Number(v.slice(13, 15)) : 0,
  });
}

function organizerIdentity(
  event: VEvent,
  feedUrl: string,
): { organizerKeys: string[]; name?: string } {
  const org = event.ORGANIZER;
  const mail = org ? (/mailto:([^;]+)/i.exec(org)?.[1] ?? org) : undefined;
  const cn = /CN=([^;:]+)/i.exec(event.ORGANIZER_PARAMS ?? '')?.[1];
  const name = cn ? unescapeIcs(cn.replace(/^"|"$/g, '')) : undefined;
  let fallback = 'ics-feed';
  try {
    fallback = new URL(feedUrl).hostname;
  } catch {
    /* keep ics-feed */
  }
  return {
    organizerKeys: organizerKeys({
      emails: [mail],
      names: [name],
      fallback,
    }),
    ...(name ? { name } : {}),
  };
}

function mapEvent(event: VEvent, feedUrl: string): IncomingEvent | null {
  const uid = event.UID?.trim();
  const summary = event.SUMMARY ? unescapeIcs(event.SUMMARY).trim() : '';
  if (!uid || !summary) return null;
  const dtStart = event.DTSTART ? icsDateToIso(event.DTSTART, event.DTSTART_PARAMS) : null;
  const dtEnd = event.DTEND ? icsDateToIso(event.DTEND, event.DTEND_PARAMS) : undefined;
  const urlRaw = event.URL?.trim();
  let sourceUrl = feedUrl;
  if (urlRaw) {
    try {
      const u = new URL(urlRaw);
      if (u.protocol === 'https:' || u.protocol === 'http:') sourceUrl = u.toString();
    } catch {
      /* keep feedUrl */
    }
  }
  const { organizerKeys: keys, name } = organizerIdentity(event, feedUrl);
  const description = event.DESCRIPTION ? unescapeIcs(event.DESCRIPTION).trim() : undefined;
  const venueName = event.LOCATION ? unescapeIcs(event.LOCATION).trim() : undefined;
  return {
    externalId: uid,
    title: summary.slice(0, 300),
    description: description || undefined,
    mode: 'physical',
    ...(dtStart ? { startsAt: dtStart } : {}),
    ...(dtStart && dtEnd ? { endsAt: dtEnd } : {}),
    timezone: 'Europe/Stockholm',
    venueName: venueName || undefined,
    sourceUrl,
    ...(sourceUrl !== feedUrl ? { links: [{ type: 'info' as const, url: sourceUrl }] } : {}),
    organizerKeys: keys,
    organizerName: name,
    categoryHints: [],
    tags: [],
  };
}

export const icsFeed = defineAdapter<IcsRaw>({
  slug: 'ics-feed',
  kind: 'feed',
  async fetchRaw(ctx: SourceRunContext) {
    const feedUrl = feedUrlFromConfig(ctx.config);
    ctx.log('Fetching ICS feed', { feedUrl });
    const res = await ctx.fetch(feedUrl, {
      headers: { Accept: 'text/calendar, text/plain, */*' },
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error('ICS feed redirects are not followed');
    }
    if (!res.ok) throw new Error(`ICS feed request failed (${res.status})`);
    const body = await res.text();
    return { body, feedUrl };
  },
  map(raw) {
    return parseVEvents(raw.body)
      .map((ev) => mapEvent(ev, raw.feedUrl))
      .filter((e): e is IncomingEvent => e != null);
  },
});

import type { EventMeta } from '@local-events/contracts';
import {
  eventAddress,
  organizerKeys,
  priceAmountFromText,
  stockholmWallTime,
} from '@local-events/domain';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';
import { load, type CheerioAPI } from 'cheerio';

/**
 * Söderhamns stadsbibliotek via the public Sitevision calendar.
 * robots.txt allows the calendar and disallows jsessionid URLs, so later pages
 * use skip on the clean list URL. Each event page is one occasion. A page with no date is still saved, with empty start and end. The Sitevision
 * page id is the external id. The place address is stored. The scan geocodes a missing point.
 */

const DEFAULT_ORIGIN = 'https://www.soderhamn.se';
const DEFAULT_LIST_PATH = '/underwebbar/biblioteket/evenemang-pa-biblioteket.html';
const DEFAULT_PORTLET_ID = '12.5ca6a40216737843363b2f36';
const DEFAULT_PAGE_SIZE = 10;
const MAX_LIST_PAGES = 30;
const LIBRARY_EMAIL = 'biblioteket@soderhamn.se';
const ORGANIZER_FALLBACK = 'Söderhamns stadsbibliotek';

const MONTHS: Record<string, number> = {
  januari: 1,
  februari: 2,
  mars: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  augusti: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

export interface BibliotekEvent {
  id: string;
  path: string;
  title: string;
  intro?: string;
  description?: string;
  imageUrl?: string;
  /** Missing when the page has no date the importer can read. */
  date?: { year: number; month: number; day: number };
  start?: string;
  end?: string;
  /** Whole day when the page gives a date and no clock. */
  wholeDay: boolean;
  city?: string;
  place?: string;
  priceText?: string;
  organizerName?: string;
  organizerEmail?: string;
  location?: { lat: number; lng: number };
}

export interface BibliotekRaw {
  now: string;
  origin: string;
  events: BibliotekEvent[];
}

function originFromConfig(config: Record<string, unknown>): URL {
  const raw =
    typeof config.origin === 'string' && config.origin.trim()
      ? config.origin.trim()
      : DEFAULT_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('soderhamn-biblioteket config.origin is not a URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'www.soderhamn.se' && host !== 'soderhamn.se')) {
    throw new Error('soderhamn-biblioteket config.origin must be https://www.soderhamn.se');
  }
  return new URL(`https://${host}`);
}

function listPathFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.listPath === 'string' ? config.listPath.trim() : DEFAULT_LIST_PATH;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('..') || raw.includes('?')) {
    throw new Error('soderhamn-biblioteket config.listPath must be a site path');
  }
  return raw;
}

function portletIdFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.portletId === 'string' ? config.portletId.trim() : DEFAULT_PORTLET_ID;
  if (!/^\d+\.[0-9a-f]+$/i.test(raw)) {
    throw new Error('soderhamn-biblioteket config.portletId must be a Sitevision id');
  }
  return raw;
}

function pageSizeFromConfig(config: Record<string, unknown>): number {
  const raw = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 50) return DEFAULT_PAGE_SIZE;
  return size;
}

function delayMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.delayMs ?? 200;
  const ms = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) return 200;
  return ms;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameHost(origin: URL, url: URL): boolean {
  return url.hostname.toLowerCase() === origin.hostname.toLowerCase();
}

/** `Response.url` is empty when a test builds the response itself. */
function responseUrl(response: Response, request: URL): URL {
  if (!response.url) return request;
  try {
    return new URL(response.url);
  } catch {
    return request;
  }
}

function absoluteUrl(value: string | undefined, origin: URL): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim().replaceAll(' ', '%20'), origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function textOf(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Sitevision puts the marker first and the text portlet as its next sibling. */
function markerParagraphs($: CheerioAPI, id: string): string | undefined {
  const marker = $(`#${id}`);
  const sibling = marker.next('.sv-text-portlet-content');
  const root = sibling.length > 0 ? sibling : marker;
  const parts: string[] = [];
  root.find('p').each((_, el) => {
    const text = textOf($(el).text());
    if (text) parts.push(text);
  });
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function infoFields($: CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $('.sol-event-info .sol-event-info-field').each((_, el) => {
    const label = textOf($(el).find('span').first().text())
      .replace(/:$/, '')
      .toLocaleLowerCase('sv');
    const clone = $(el).clone();
    clone.find('span').remove();
    const value = textOf(clone.text());
    if (label && value) fields[label] = value;
  });
  return fields;
}

/** Event page path. The calendar page and a jsessionid URL are not events. */
export function eventPath(href: string, origin: URL): string | null {
  const cleaned = href.replace(/&amp;/g, '&').replace(/;jsessionid=[^?&#]*/gi, '');
  let url: URL;
  try {
    url = new URL(cleaned, origin);
  } catch {
    return null;
  }
  if (!sameHost(origin, url)) return null;
  if (!/\/evenemang-?bibliotek\//i.test(url.pathname) || !url.pathname.endsWith('.html')) {
    return null;
  }
  return url.pathname;
}

export function parseListPage(html: string, origin: URL): string[] {
  const $ = load(html);
  if ($('ul.sv-channel').length === 0) {
    throw new Error('soderhamn-biblioteket list has no event channel');
  }
  const paths: string[] = [];
  $('a.sol-article-item').each((_, el) => {
    const path = eventPath($(el).attr('href') ?? '', origin);
    if (path && !paths.includes(path)) paths.push(path);
  });
  return paths;
}

function swedishDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = value.toLocaleLowerCase('sv').match(/(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/u);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = MONTHS[match[2] ?? ''];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 2000 || year > 2100) return undefined;
  return { year, month, day };
}

function clockRange(value: string | undefined): {
  start?: string;
  end?: string;
  wholeDay: boolean;
} {
  const text = textOf(value).toLocaleLowerCase('sv');
  if (!text || /heldag|hela dagen/.test(text)) return { wholeDay: true };
  const clocks = [...text.matchAll(/(\d{1,2})[:.](\d{2})/g)];
  const start = clock(clocks[0]);
  const end = clock(clocks[1]);
  if (!start) return { wholeDay: true };
  return { start, ...(end ? { end } : {}), wholeDay: false };
}

function clock(match: RegExpMatchArray | undefined): string | undefined {
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function organizerNameFrom(description: string | undefined): string | undefined {
  const match = description?.match(/arrangör:\s*(.+)/i);
  const name = textOf(match?.[1]);
  if (!name || name.length > 200) return undefined;
  return name;
}

/** The library desk. The chief's address on the same card is not the organizer. */
function libraryEmail($: CheerioAPI): string | undefined {
  let found = false;
  $('a[href^="mailto:"]').each((_, el) => {
    const email = ($(el).attr('href') ?? '')
      .replace(/^mailto:/i, '')
      .trim()
      .toLowerCase();
    if (email === LIBRARY_EMAIL) found = true;
  });
  return found ? LIBRARY_EMAIL : undefined;
}

function pageIdOf(html: string, path: string): string {
  const match = html.match(/pageId:\s*'(\d+\.[0-9a-f]+)'/i);
  return match?.[1] ?? path;
}

/**
 * One Sitevision event page. A page without a date is kept, with empty start and end.
 * The library desk is the organizer email. The chief's address is not.
 */
export function parseEventPage(html: string, path: string, origin: URL): BibliotekEvent | null {
  const $ = load(html);
  const fields = infoFields($);
  const date = swedishDate(fields.datum ?? '');
  const title =
    textOf($('h1').first().text()) || textOf($('meta[property="og:title"]').attr('content'));
  if (!title) return null;
  const canonical = eventPath($('link[rel="canonical"]').attr('href') ?? '', origin) ?? path;
  const intro = markerParagraphs($, 'Ingress');
  const body = markerParagraphs($, 'Innehall');
  const dateNote = date
    ? ''
    : [fields.datum ? `Datum: ${fields.datum}` : '', fields.tid ? `Tid: ${fields.tid}` : '']
        .filter(Boolean)
        .join('\n');
  const description = [body, dateNote].filter(Boolean).join('\n\n') || undefined;
  const clocks = date ? clockRange(fields.tid) : { wholeDay: false };
  const imageUrl = absoluteUrl($('meta[property="og:image"]').attr('content'), origin);
  return {
    id: pageIdOf(html, canonical),
    path: canonical,
    title,
    ...(intro ? { intro } : {}),
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(date ? { date } : {}),
    ...(clocks.start ? { start: clocks.start } : {}),
    ...(clocks.end ? { end: clocks.end } : {}),
    wholeDay: clocks.wholeDay,
    ...(fields.ort ? { city: fields.ort } : {}),
    ...(fields.plats ? { place: fields.plats } : {}),
    ...(fields.pris ? { priceText: fields.pris } : {}),
    ...(organizerNameFrom(description) ? { organizerName: organizerNameFrom(description) } : {}),
    ...(libraryEmail($) ? { organizerEmail: libraryEmail($) } : {}),
  };
}

function descriptionOf(event: BibliotekEvent): string | undefined {
  const body = event.description?.trim();
  const intro = event.intro?.trim();
  if (intro && body && !body.toLocaleLowerCase('sv').includes(intro.toLocaleLowerCase('sv'))) {
    return `${intro}\n\n${body}`;
  }
  return body || intro;
}

function venueAndAddress(event: BibliotekEvent): {
  venueName?: string;
  address?: string;
  street?: string;
  zipCode?: string;
} {
  const city = textOf(event.city);
  const cityKey = city.toLocaleLowerCase('sv');
  const parts = textOf(event.place)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part.toLocaleLowerCase('sv') !== cityKey);
  const zipCode = parts.find((part) => /^\d{3}\s?\d{2}$/.test(part));
  const rest = parts.filter((part) => part !== zipCode);
  if (rest.length === 0)
    return { ...(city ? { venueName: city } : {}), ...(zipCode ? { zipCode } : {}) };
  if (rest.length === 1) {
    const venueName = rest[0]!;
    const address = [venueName, zipCode, city].filter(Boolean).join(', ');
    return { venueName, ...(address ? { address } : {}), ...(zipCode ? { zipCode } : {}) };
  }
  const last = rest.at(-1)!;
  const room = rest.length >= 3 && !/\d/.test(last) ? last : undefined;
  const venueName = room ? `${rest[0]}, ${room}` : rest[0]!;
  const street = rest.slice(1, room ? -1 : undefined).join(', ');
  const address = [street, zipCode, city].filter(Boolean).join(', ');
  return {
    venueName,
    ...(address ? { address } : {}),
    ...(street ? { street } : {}),
    ...(zipCode ? { zipCode } : {}),
  };
}

function atWall(date: NonNullable<BibliotekEvent['date']>, clockText: string): string {
  const [hour, minute] = clockText.split(':').map(Number);
  return stockholmWallTime({
    year: date.year,
    month: date.month,
    day: date.day,
    hour: hour ?? 0,
    minute: minute ?? 0,
  });
}

function freeEntry(priceText: string | undefined, amount: number | undefined): boolean {
  if (amount === 0) return true;
  if (!priceText) return false;
  return /(?<![\p{L}])(?:gratis|fritt inträde|fri entré|kostnadsfritt)(?![\p{L}])/iu.test(
    priceText,
  );
}

export function mapBibliotekEvent(event: BibliotekEvent, origin: string): IncomingEvent | null {
  const sourceUrl = absoluteUrl(event.path, new URL(origin));
  if (!sourceUrl) return null;
  const { venueName, address, street, zipCode } = venueAndAddress(event);
  const description = descriptionOf(event);
  const parsedPrice = priceAmountFromText(event.priceText?.replace(/\bSEK\b/gi, 'kr'));
  const free = freeEntry(event.priceText, parsedPrice);
  const priceAmount = parsedPrice ?? (free ? 0 : undefined);
  const meta: EventMeta = {};
  if (free) meta.freeEntry = true;
  const place = eventAddress({
    address: street,
    zipCode,
    city: event.city,
    location: event.location,
  });
  if (place) meta.address = place;
  const startsAt = !event.date
    ? undefined
    : event.wholeDay || !event.start
      ? atWall(event.date, '00:00')
      : atWall(event.date, event.start);
  const endsAt = !event.date
    ? undefined
    : event.wholeDay || !event.start
      ? startsAt
      : event.end
        ? atWall(event.date, event.end)
        : undefined;
  const organizerName =
    event.organizerName ?? (event.organizerEmail ? ORGANIZER_FALLBACK : undefined);
  return {
    externalId: event.id,
    title: event.title,
    ...(description ? { description } : {}),
    mode: 'physical',
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    timezone: 'Europe/Stockholm',
    ...(venueName ? { venueName } : {}),
    ...(address ? { address } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: 'SEK' as const } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    sourceUrl,
    links: [{ type: 'info', url: sourceUrl }],
    organizerKeys: organizerKeys({
      emails: [event.organizerEmail],
      names: [organizerName],
      fallback: 'soderhamn-biblioteket',
      skipHosts: ['soderhamn.se'],
    }),
    ...(organizerName ? { organizerName } : {}),
    ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
    categoryHints: [],
    tags: [],
  };
}

function listUrl(origin: URL, listPath: string, portletId: string, skip: number): URL {
  if (skip <= 0) return new URL(listPath, origin);
  const url = new URL(listPath, origin);
  url.searchParams.set('sv.url', portletId);
  url.searchParams.set('skip', String(skip));
  url.searchParams.set('state', 'view');
  return url;
}

async function fetchPaths(ctx: SourceRunContext, origin: URL): Promise<string[]> {
  const listPath = listPathFromConfig(ctx.config);
  const portletId = portletIdFromConfig(ctx.config);
  const pageSize = pageSizeFromConfig(ctx.config);
  const delayMs = delayMsFromConfig(ctx.config);
  const paths: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    if (ctx.limit != null && paths.length >= ctx.limit) break;
    const url = listUrl(origin, listPath, portletId, page * pageSize);
    if (page > 0) await sleep(delayMs);
    const response = await ctx.fetch(url);
    if (!response.ok) throw new Error(`soderhamn-biblioteket list failed (${response.status})`);
    if (!sameHost(origin, responseUrl(response, url))) {
      throw new Error('soderhamn-biblioteket list redirected off the calendar host');
    }
    const found = parseListPage(await response.text(), origin);
    let added = 0;
    for (const path of found) {
      if (paths.includes(path)) continue;
      paths.push(path);
      added += 1;
      if (ctx.limit != null && paths.length >= ctx.limit) break;
    }
    if (found.length < pageSize || added === 0) break;
  }
  return paths;
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<BibliotekRaw> {
  const origin = originFromConfig(ctx.config);
  const delayMs = delayMsFromConfig(ctx.config);
  const paths = await fetchPaths(ctx, origin);
  let yielded = 0;
  for (const path of paths) {
    if (ctx.limit != null && yielded >= ctx.limit) break;
    const pageUrl = new URL(path, origin);
    if (!sameHost(origin, pageUrl)) continue;
    await sleep(delayMs);
    const response = await ctx.fetch(pageUrl);
    if (!response.ok || !sameHost(origin, responseUrl(response, pageUrl))) {
      ctx.log('soderhamn-biblioteket skipped event page', { path, status: response.status });
      continue;
    }
    const event = parseEventPage(await response.text(), path, origin);
    if (!event) {
      ctx.log('soderhamn-biblioteket skipped event with no title', { path });
      continue;
    }
    yielded += 1;
    yield { now: new Date().toISOString(), origin: origin.origin, events: [event] };
  }
  if (paths.length > 0 && yielded === 0) {
    throw new Error('soderhamn-biblioteket event pages had no usable events');
  }
}

export const soderhamnBiblioteket = defineAdapter<BibliotekRaw>({
  slug: 'soderhamn-biblioteket',
  kind: 'scraper',
  each: eachEvent,
  async fetchRaw(ctx) {
    const events: BibliotekEvent[] = [];
    let origin = '';
    let now = new Date().toISOString();
    for await (const raw of eachEvent(ctx)) {
      origin = raw.origin;
      now = raw.now;
      events.push(...raw.events);
    }
    return { now, origin, events };
  },
  map(raw) {
    const origin = raw.origin || DEFAULT_ORIGIN;
    return raw.events.flatMap((event) => {
      const mapped = mapBibliotekEvent(event, origin);
      return mapped ? [mapped] : [];
    });
  },
});

import type { EventMeta } from '@local-events/contracts';
import {
  eventAddress,
  eventUrlKey,
  mergeImportedLinks,
  organizerKeys,
  priceAmountFromText,
  sourceDateTime,
  type ImportEventLink,
} from '@local-events/domain';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';
import { isPublicHttpsImageUrl } from '../../event-images';
import { robotsAllows } from '../html-calendar';

/**
 * Nortic public events. The key is NORTIC_API_KEY, never config.
 * The worker pages `GET /api/ajar/public/v1/events?city=` on services.nortic.se.
 * A city is kept when it is one of the configured cities. One product is one event.
 * The ticket page `https://tickets.nortic.se/ticket/event/{id}` supplies each showing,
 * the street address, and the price. A clock on that page is Europe/Stockholm.
 * A `Z` time from the list is that instant, and is used only when the ticket page
 * has no showing. The offer price is major-unit SEK. The import does not geocode.
 * `robots.txt` on tickets.nortic.se disallows `/ticket/ajax` and `/ticket/checkout`.
 * A redirect off the requested host fails that request.
 */

const API_ORIGIN = 'https://services.nortic.se';
const API_HOST = 'services.nortic.se';
const API_PATH = '/api/ajar/public/v1/events';
const TICKET_HOST = 'tickets.nortic.se';
const IMAGE_HOST = 'branding.nortic.io';
const API_KEY_ENV = 'NORTIC_API_KEY';
const DEFAULT_CITIES = ['Söderhamn', 'Bollnäs', 'Hudiksvall', 'Ljusdal'];
const ORGANIZER_FALLBACK = 'nortic';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_WITHIN_DAYS = 365;
const MAX_PAGES = 20;
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_WAIT_MS = 5_000;
const MAX_MAJOR = 100_000;
const MAX_TICKET_CHARS = 2_000_000;
const EVENT_ID = /^\d{1,12}$/;
const FREE = /(?<![\p{L}])(?:gratis|fritt inträde|fri entré|kostnadsfritt)(?![\p{L}])/iu;

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

const SHOW_RANGE =
  /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)(?:\s+(\d{4}))?\s+(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/giu;

export interface NorticShow {
  sourceKey?: string;
  startsAt: string;
  endsAt: string;
  venueName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  priceAmount?: number;
}

export interface NorticEvent {
  id: string;
  title: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  eventUrl: string;
  organizerId?: string;
  organizerName?: string;
  city?: string;
  venueName?: string;
  startsAt?: string;
  endsAt?: string;
  shows: NorticShow[];
}

export interface NorticRaw {
  events: NorticEvent[];
}

interface NorticSettings {
  cities: string[];
  pageSize: number;
  withinDays: number;
  delayMs: number;
}

interface NorticPage {
  events: NorticEvent[];
  totalPages: number;
}

interface ShowRange {
  day: number;
  month: number;
  year?: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function idText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  return textOf(value);
}

function cityKey(city: string): string {
  return city.trim().toLocaleLowerCase('sv');
}

/** A venue city matches a configured city. An empty city does not. */
export function norticCityMatches(city: string | undefined, allowed: string[]): boolean {
  if (!city?.trim()) return false;
  const key = cityKey(city);
  return allowed.some((name) => {
    const allowedKey = cityKey(name);
    return (
      key === allowedKey || key.startsWith(`${allowedKey} `) || key.startsWith(`${allowedKey},`)
    );
  });
}

function citiesFromConfig(config: Record<string, unknown>): string[] {
  const raw = config.cities ?? DEFAULT_CITIES;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) {
    throw new Error('nortic config.cities must be 1–12 city names');
  }
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!/^[\p{L}][\p{L} .'-]{0,40}$/u.test(name)) {
      throw new Error('nortic config.cities must be city names');
    }
    const key = name.toLocaleLowerCase('sv');
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(name);
  }
  if (cities.length === 0) throw new Error('nortic config.cities must be 1–12 city names');
  return cities;
}

function pageSizeFromConfig(config: Record<string, unknown>): number {
  const raw = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new Error('nortic config.pageSize must be 1–100');
  }
  return size;
}

function withinDaysFromConfig(config: Record<string, unknown>): number {
  const raw = config.startsWithinDays ?? DEFAULT_WITHIN_DAYS;
  const days = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error('nortic config.startsWithinDays must be 1–400');
  }
  return days;
}

function delayMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.delayMs ?? 200;
  const delay = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) return 200;
  return delay;
}

function settingsFromConfig(config: Record<string, unknown>): NorticSettings {
  return {
    cities: citiesFromConfig(config),
    pageSize: pageSizeFromConfig(config),
    withinDays: withinDaysFromConfig(config),
    delayMs: delayMsFromConfig(config),
  };
}

function apiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error(`${API_KEY_ENV} is not set`);
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseUrl(response: Response, fallback: URL): URL {
  try {
    return new URL(response.url || fallback);
  } catch {
    return fallback;
  }
}

function sameHost(url: URL, host: string): boolean {
  return url.protocol === 'https:' && url.hostname.toLowerCase() === host;
}

function instantOf(value: unknown): string | undefined {
  const text = textOf(value);
  if (!text) return undefined;
  try {
    return sourceDateTime(text);
  } catch {
    return undefined;
  }
}

function prose(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function ageLimitOf(description: string): number | undefined {
  const match = /åldersgräns\s*:?\s*(\d{1,3})|\bfrån\s+(\d{1,2})\s+år\b/iu.exec(description);
  const years = Number(match?.[1] ?? match?.[2]);
  if (!Number.isInteger(years) || years < 1 || years > 99) return undefined;
  return years;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function wallTime(year: number, month: number, day: number, hour: number, minute: number): string {
  return sourceDateTime(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`);
}

function nextDay(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function httpsUrl(value: unknown): string | undefined {
  const raw = textOf(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The event's own ticket page. Ajax, checkout, and any other host are refused. */
export function norticTicketUrl(eventUrl: string, id: string): URL | undefined {
  if (!EVENT_ID.test(id)) return undefined;
  try {
    const url = new URL(eventUrl);
    if (!sameHost(url, TICKET_HOST) || url.username || url.password || url.search) return undefined;
    if (url.pathname !== `/ticket/event/${id}`) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function listUrl(page: number, city: string, pageSize: number, withinDays: number): URL {
  const url = new URL(API_PATH, API_ORIGIN);
  url.searchParams.set('city', city);
  url.searchParams.set('startsWithinDays', String(withinDays));
  url.searchParams.set('sort', 'DATE');
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', String(pageSize));
  return url;
}

function minorPrice(value: unknown, currency: unknown): number | undefined {
  const currencyText = textOf(currency)?.toUpperCase();
  if (currencyText && currencyText !== 'SEK') return undefined;
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : textOf(value)?.replace(',', '.');
  if (!text || !/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return undefined;
  const major = Number(text);
  if (!Number.isFinite(major) || major > MAX_MAJOR) return undefined;
  const minor = Math.round(major * 100);
  return minor <= 10_000_000 ? minor : undefined;
}

function venueNameOf(name: string | undefined, city: string | undefined): string | undefined {
  if (!name) return undefined;
  if (!city) return name;
  const suffix = ` - ${city}`;
  if (name.toLocaleLowerCase('sv').endsWith(suffix.toLocaleLowerCase('sv'))) {
    const trimmed = name.slice(0, -suffix.length).trim();
    return trimmed || name;
  }
  return name;
}

function sharedValue(values: Array<string | undefined>): string | undefined {
  const names = [...new Set(values.filter((value) => value != null))];
  return names.length === 1 ? names[0] : undefined;
}

function clockParts(
  value: string,
): { year: number; month: number; day: number; hour: number; minute: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

function showRanges(html: string): ShowRange[] {
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
  const ranges: ShowRange[] = [];
  for (const match of visible.matchAll(SHOW_RANGE)) {
    const day = Number(match[1]);
    const month = MONTHS[match[2]!.toLocaleLowerCase('sv')];
    const year = match[3] ? Number(match[3]) : undefined;
    const startHour = Number(match[4]);
    const startMinute = Number(match[5]);
    const endHour = Number(match[6]);
    const endMinute = Number(match[7]);
    if (!month || day < 1 || day > 31) continue;
    if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) continue;
    ranges.push({ day, month, year, startHour, startMinute, endHour, endMinute });
  }
  return ranges;
}

function endFor(start: string, ranges: ShowRange[]): string | undefined {
  const parts = clockParts(start);
  if (!parts) return undefined;
  const range = ranges.find(
    (item) =>
      item.day === parts.day &&
      item.month === parts.month &&
      item.startHour === parts.hour &&
      item.startMinute === parts.minute &&
      (item.year == null || item.year === parts.year),
  );
  if (!range) return undefined;
  const startMinutes = range.startHour * 60 + range.startMinute;
  const endMinutes = range.endHour * 60 + range.endMinute;
  const day = endMinutes <= startMinutes ? nextDay(parts.year, parts.month, parts.day) : parts;
  return wallTime(day.year, day.month, day.day, range.endHour, range.endMinute);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function typeIncludes(value: unknown, type: string): boolean {
  return asArray(value).some((item) => textOf(item) === type);
}

function placeOf(value: unknown): {
  venueName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
} {
  const place = recordOf(value);
  const address = recordOf(place?.address);
  return {
    venueName: textOf(place?.name)?.slice(0, 500),
    street: textOf(address?.streetAddress)?.slice(0, 200),
    postalCode: textOf(address?.postalCode),
    city: textOf(address?.addressLocality)?.slice(0, 80),
  };
}

function offerOf(value: unknown): { priceAmount?: number; sourceKey?: string } {
  const offers = asArray(value)
    .map(recordOf)
    .filter((item) => item != null);
  let priceAmount: number | undefined;
  let sourceKey: string | undefined;
  for (const offer of offers) {
    const price = minorPrice(offer.price, offer.priceCurrency);
    if (price !== undefined && (priceAmount === undefined || price < priceAmount))
      priceAmount = price;
    const url = httpsUrl(offer.url);
    if (!sourceKey && url) {
      try {
        const parsed = new URL(url);
        const id = parsed.pathname.split('/').find((part) => EVENT_ID.test(part));
        if (id && sameHost(parsed, TICKET_HOST)) sourceKey = id;
      } catch {
        sourceKey = undefined;
      }
    }
  }
  return {
    ...(priceAmount !== undefined ? { priceAmount } : {}),
    ...(sourceKey ? { sourceKey } : {}),
  };
}

function ldEvents(html: string): unknown[] {
  const events: unknown[] = [];
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script[1] ?? '');
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const record = recordOf(node);
      if (!record) continue;
      if (typeIncludes(record['@type'], 'Event')) events.push(record);
      for (const child of asArray(record['@graph'])) {
        const graph = recordOf(child);
        if (graph && typeIncludes(graph['@type'], 'Event')) events.push(graph);
      }
    }
  }
  return events;
}

/** Showings, address, and price from the ticket page. A showing without an end is left out. */
export function parseNorticShows(html: string): NorticShow[] {
  const ranges = showRanges(html);
  const shows: NorticShow[] = [];
  const seen = new Set<string>();
  for (const node of ldEvents(html)) {
    const record = recordOf(node);
    const start = textOf(record?.startDate);
    const parts = start ? clockParts(start) : undefined;
    if (!parts) continue;
    let startsAt: string;
    try {
      startsAt = wallTime(parts.year, parts.month, parts.day, parts.hour, parts.minute);
    } catch {
      continue;
    }
    const endsAt = endFor(start!, ranges);
    if (!endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) continue;
    const place = placeOf(record?.location);
    const offer = offerOf(record?.offers);
    const key = `${startsAt}\u0000${offer.sourceKey ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shows.push({
      ...(offer.sourceKey ? { sourceKey: offer.sourceKey } : {}),
      startsAt,
      endsAt,
      ...(place.venueName ? { venueName: venueNameOf(place.venueName, place.city) } : {}),
      ...(place.street ? { street: place.street } : {}),
      ...(place.postalCode ? { postalCode: place.postalCode } : {}),
      ...(place.city ? { city: place.city } : {}),
      ...(offer.priceAmount !== undefined ? { priceAmount: offer.priceAmount } : {}),
    });
  }
  shows.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return shows;
}

export function parseNorticEvent(value: unknown): NorticEvent | undefined {
  const record = recordOf(value);
  const id = idText(record?.id);
  const title = textOf(record?.name)?.slice(0, 300);
  const eventUrl = httpsUrl(record?.eventUrl);
  if (!record || !id || !EVENT_ID.test(id) || !title || !eventUrl) return undefined;
  const organizer = recordOf(record.organizer);
  const location = recordOf(record.location);
  const venue = recordOf(location?.venue);
  const startsAt = instantOf(record.startsAt);
  const endsAt = instantOf(record.endsAt);
  const imageUrl = httpsUrl(record.imageUrl);
  return {
    id,
    title,
    ...(textOf(record.description) ? { description: textOf(record.description) } : {}),
    ...(textOf(record.category) ? { category: textOf(record.category) } : {}),
    ...(imageUrl && isPublicHttpsImageUrl(imageUrl) ? { imageUrl } : {}),
    eventUrl,
    ...(idText(organizer?.id) ? { organizerId: idText(organizer?.id) } : {}),
    ...(textOf(organizer?.name) ? { organizerName: textOf(organizer?.name) } : {}),
    ...(textOf(location?.city) ? { city: textOf(location?.city) } : {}),
    ...(textOf(venue?.name) ? { venueName: textOf(venue?.name)?.slice(0, 500) } : {}),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt && startsAt && new Date(endsAt).getTime() > new Date(startsAt).getTime()
      ? { endsAt }
      : {}),
    shows: [],
  };
}

export function parseNorticPage(value: unknown): NorticPage {
  const record = recordOf(value);
  const items = record?.items;
  if (!Array.isArray(items)) throw new Error('nortic event list has no items');
  const events: NorticEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const event = parseNorticEvent(item);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  const pagination = recordOf(record?.pagination);
  const totalPages =
    typeof pagination?.totalPages === 'number' && Number.isFinite(pagination.totalPages)
      ? pagination.totalPages
      : 1;
  return { events, totalPages };
}

function fallbackShow(event: NorticEvent): NorticShow | undefined {
  if (!event.startsAt || !event.endsAt) return undefined;
  return {
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    ...(event.venueName ? { venueName: event.venueName } : {}),
    ...(event.city ? { city: event.city } : {}),
  };
}

function addLink(
  links: ImportEventLink[],
  rawUrl: string | undefined,
  type: ImportEventLink['type'],
  label?: string,
): void {
  if (!rawUrl) return;
  const key = eventUrlKey(rawUrl);
  if (!key || links.some((link) => eventUrlKey(link.url) === key) || links.length >= 10) return;
  links.push(label ? { type, url: key, label } : { type, url: key });
}

export function mapNorticEvent(event: NorticEvent): IncomingEvent {
  const written = event.description ? prose(event.description).slice(0, 20_000) : '';
  const shows =
    event.shows.length > 0 ? event.shows : [fallbackShow(event)].filter((show) => show != null);
  const occasions = shows.map((show) => ({
    startsAt: show.startsAt,
    endsAt: show.endsAt,
    ...(show.venueName ? { venueName: show.venueName } : {}),
    ...(show.sourceKey ? { sourceKey: show.sourceKey } : {}),
  }));
  const first = occasions[0];
  const last = occasions.at(-1);
  const venueName = sharedValue(shows.map((show) => show.venueName)) ?? event.venueName;
  const street = sharedValue(shows.map((show) => show.street));
  const postalCode = sharedValue(shows.map((show) => show.postalCode));
  const city = sharedValue(shows.map((show) => show.city)) ?? event.city;
  const address = eventAddress({
    ...(street ? { address: street } : {}),
    ...(postalCode ? { zipCode: postalCode } : {}),
    ...(city ? { city } : {}),
  });
  const offerPrice = shows.reduce<number | undefined>((lowest, show) => {
    if (show.priceAmount === undefined) return lowest;
    return lowest === undefined || show.priceAmount < lowest ? show.priceAmount : lowest;
  }, undefined);
  const fromText = priceAmountFromText(written) ?? (FREE.test(written) ? 0 : undefined);
  const priceAmount = offerPrice !== undefined ? offerPrice : fromText;
  const ageLimit = ageLimitOf(written);
  const meta: EventMeta = {};
  if (priceAmount === 0) meta.freeEntry = true;
  if (ageLimit !== undefined) meta.ageLimit = ageLimit;
  if (address) meta.address = address;
  const links: ImportEventLink[] = [];
  addLink(links, event.eventUrl, 'tickets', 'Nortic');
  const merged = mergeImportedLinks(links, written) ?? [];
  const place = [street, city].filter(Boolean).join(', ');
  return {
    externalId: event.id,
    title: event.title,
    ...(written ? { description: written } : {}),
    mode: 'physical',
    ...(first ? { startsAt: first.startsAt } : {}),
    ...(last ? { endsAt: last.endsAt } : {}),
    ...(occasions.length > 0 ? { occasions } : {}),
    timezone: 'Europe/Stockholm',
    ...(venueName ? { venueName } : {}),
    ...(place ? { address: place } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: 'SEK' as const } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    ...(merged.length > 0 ? { links: merged } : {}),
    sourceUrl: event.eventUrl,
    organizerKeys: organizerKeys({
      ids: [event.organizerId],
      names: [event.organizerName],
      town: city,
      fallback: ORGANIZER_FALLBACK,
      skipHosts: [API_HOST, TICKET_HOST, IMAGE_HOST, 'nortic.se'],
    }),
    ...(event.organizerName ? { organizerName: event.organizerName } : {}),
    ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
    categoryHints: event.category ? [event.category] : [],
    tags: [],
  };
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get('retry-after')?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (seconds >= 0 && seconds <= 15 * 60) return seconds * 1000;
  }
  return RATE_LIMIT_WAIT_MS;
}

async function readResponse(
  ctx: SourceRunContext,
  url: URL,
  key: string,
  accept: string,
  redirect: 'error' | 'manual',
): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  if (sameHost(url, API_HOST)) headers['X-Api-Key'] = key;
  for (let attempt = 0; ; attempt += 1) {
    const response = await ctx.fetch(url, { headers, redirect });
    if (response.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error('Nortic API request failed (429)');
      }
      ctx.log('nortic rate limit', { retry: attempt + 1 });
      const pause = retryAfterMs(response);
      if (pause > 0) await sleep(pause);
      continue;
    }
    return response;
  }
}

async function readJson(ctx: SourceRunContext, url: URL, key: string): Promise<unknown> {
  const response = await readResponse(ctx, url, key, 'application/json', 'error');
  if (!sameHost(responseUrl(response, url), API_HOST)) {
    throw new Error('nortic request redirected off services.nortic.se');
  }
  if (!response.ok) throw new Error(`Nortic API request failed (${response.status})`);
  return response.json();
}

async function readText(
  ctx: SourceRunContext,
  url: URL,
  key: string,
  host: string,
): Promise<string | undefined> {
  const response = await readResponse(ctx, url, key, 'text/html', 'error');
  if (!sameHost(responseUrl(response, url), host)) {
    throw new Error('nortic request redirected off the requested host');
  }
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Nortic page request failed (${response.status})`);
  const text = await response.text();
  return text.length <= MAX_TICKET_CHARS ? text : undefined;
}

async function robotsOf(ctx: SourceRunContext, origin: string, key: string): Promise<string> {
  const url = new URL('/robots.txt', origin);
  const response = await readResponse(ctx, url, key, 'text/plain', 'error');
  if (response.status === 404) {
    await response.body?.cancel();
    return '';
  }
  if (!sameHost(responseUrl(response, url), url.hostname.toLowerCase())) {
    throw new Error('nortic robots.txt redirected off the requested host');
  }
  if (!response.ok) throw new Error(`Nortic robots.txt request failed (${response.status})`);
  return response.text();
}

async function directImageUrl(
  ctx: SourceRunContext,
  imageUrl: string,
  key: string,
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return undefined;
  }
  if (!sameHost(url, IMAGE_HOST)) return isPublicHttpsImageUrl(imageUrl) ? imageUrl : undefined;
  const response = await readResponse(ctx, url, key, 'image/*,*/*', 'manual');
  await response.body?.cancel();
  if (!sameHost(responseUrl(response, url), IMAGE_HOST)) return undefined;
  if (response.ok) return imageUrl;
  if (response.status !== 301 && response.status !== 302 && response.status !== 303)
    return undefined;
  const location = response.headers.get('location');
  if (!location) return undefined;
  try {
    const next = new URL(location, url);
    return isPublicHttpsImageUrl(next.href) ? next.href : undefined;
  } catch {
    return undefined;
  }
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<NorticRaw> {
  const settings = settingsFromConfig(ctx.config);
  const key = apiKey();
  const seen = new Set<string>();
  let requests = 0;
  let yielded = 0;

  const pause = async (): Promise<void> => {
    if (requests > 0 && settings.delayMs > 0) await sleep(settings.delayMs);
    requests += 1;
  };

  await pause();
  const apiRobots = await robotsOf(ctx, API_ORIGIN, key);
  const sample = listUrl(
    1,
    settings.cities[0] ?? 'Söderhamn',
    settings.pageSize,
    settings.withinDays,
  );
  if (!robotsAllows(apiRobots, sample))
    throw new Error('nortic robots.txt disallows the event list');
  await pause();
  const ticketRobots = await robotsOf(ctx, `https://${TICKET_HOST}`, key);

  for (const city of settings.cities) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (ctx.limit != null && yielded >= ctx.limit) return;
      const url = listUrl(page, city, settings.pageSize, settings.withinDays);
      if (!robotsAllows(apiRobots, url))
        throw new Error('nortic robots.txt disallows the event list');
      await pause();
      const parsed = parseNorticPage(await readJson(ctx, url, key));
      for (const event of parsed.events) {
        if (ctx.limit != null && yielded >= ctx.limit) return;
        if (seen.has(event.id) || !norticCityMatches(event.city, settings.cities)) continue;
        seen.add(event.id);
        const ticket = norticTicketUrl(event.eventUrl, event.id);
        if (ticket && robotsAllows(ticketRobots, ticket)) {
          await pause();
          try {
            const html = await readText(ctx, ticket, key, TICKET_HOST);
            if (html) event.shows = parseNorticShows(html);
          } catch (error) {
            ctx.log('nortic skipped a ticket page', {
              id: event.id,
              error: error instanceof Error ? error.message : 'request failed',
            });
          }
        }
        if (event.imageUrl) {
          await pause();
          try {
            event.imageUrl = await directImageUrl(ctx, event.imageUrl, key);
          } catch (error) {
            event.imageUrl = undefined;
            ctx.log('nortic skipped an image', {
              id: event.id,
              error: error instanceof Error ? error.message : 'request failed',
            });
          }
        }
        yielded += 1;
        yield { events: [event] };
      }
      if (page >= parsed.totalPages || parsed.events.length < settings.pageSize) break;
    }
  }
  if (yielded === 0) throw new Error('nortic found no usable events');
}

export const nortic = defineAdapter<NorticRaw>({
  slug: 'nortic',
  kind: 'api',
  each: eachEvent,
  async fetchRaw(ctx) {
    const events: NorticEvent[] = [];
    for await (const raw of eachEvent(ctx)) events.push(...raw.events);
    return { events };
  },
  map(raw) {
    return raw.events.map((event) => mapNorticEvent(event));
  },
});

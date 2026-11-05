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
import { load } from 'cheerio';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';

/**
 * Billetto public event API. The key pair is BILLETTO_API_KEY and
 * BILLETTO_API_SECRET_KEY, never config. Send both as `Api-Keypair: key:secret`.
 * The worker pages `GET /api/v3/public/events` on billetto.se and saves a matching
 * event before the next page. Region and subregion filters still return other
 * places, so the city is checked here. One public event is one event.
 * A `Z` time is that instant. The venue point is stored when the API sends one.
 * A point of 0, 0 is omitted. `amount_in_cents` is the major-unit price: 165 is
 * 165 SEK. The ticket link keeps the UTM query. The import does not geocode.
 * A redirect off billetto.se fails that request.
 */

const API_ORIGIN = 'https://billetto.se';
const API_HOST = 'billetto.se';
const API_PATH = '/api/v3/public/events';
const API_VERSION = '2026-02-10';
const KEY_ENV = 'BILLETTO_API_KEY';
const SECRET_ENV = 'BILLETTO_API_SECRET_KEY';
const DEFAULT_CITIES = ['Söderhamn', 'Bollnäs', 'Hudiksvall', 'Ljusdal'];
const ORGANIZER_FALLBACK = 'billetto';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 40;
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_MAJOR = 100_000;
const EVENT_ID = /^[A-Za-z0-9_-]{1,40}$/;

export interface BillettoEvent {
  id: string;
  title: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  priceAmount?: number;
  currency?: string;
  categoryHints: string[];
  venueName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  startsAt?: string;
  endsAt?: string;
  organizerId?: string;
  organizerName?: string;
}

export interface BillettoRaw {
  events: BillettoEvent[];
}

interface BillettoSettings {
  cities: string[];
  pageSize: number;
  delayMs: number;
  rateLimitWaitMs: number;
}

interface BillettoPage {
  events: BillettoEvent[];
  rowCount: number;
  hasMore: boolean;
  nextUrl?: string;
  lastId?: string;
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

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = textOf(value)?.replace(',', '.');
  if (!text || !/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : undefined;
}

function cityKey(city: string): string {
  return city.trim().toLocaleLowerCase('sv');
}

/** A venue city matches a configured city. An empty city does not. */
export function billettoCityMatches(city: string | undefined, allowed: string[]): boolean {
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
    throw new Error('billetto config.cities must be 1–12 city names');
  }
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!/^[\p{L}][\p{L} .'-]{0,40}$/u.test(name)) {
      throw new Error('billetto config.cities must be city names');
    }
    const key = name.toLocaleLowerCase('sv');
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(name);
  }
  if (cities.length === 0) throw new Error('billetto config.cities must be 1–12 city names');
  return cities;
}

function pageSizeFromConfig(config: Record<string, unknown>): number {
  const raw = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new Error('billetto config.pageSize must be 1–100');
  }
  return size;
}

function delayMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.delayMs ?? 200;
  const delay = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) return 200;
  return delay;
}

function rateLimitWaitMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.rateLimitWaitMs ?? RATE_LIMIT_WAIT_MS;
  const wait = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(wait) || wait < 0 || wait > 15 * 60 * 1000) return RATE_LIMIT_WAIT_MS;
  return wait;
}

function settingsFromConfig(config: Record<string, unknown>): BillettoSettings {
  return {
    cities: citiesFromConfig(config),
    pageSize: pageSizeFromConfig(config),
    delayMs: delayMsFromConfig(config),
    rateLimitWaitMs: rateLimitWaitMsFromConfig(config),
  };
}

function apiKeypair(): string {
  const key = process.env[KEY_ENV]?.trim();
  const secret = process.env[SECRET_ENV]?.trim();
  if (!key || !secret) {
    throw new Error(`${KEY_ENV} and ${SECRET_ENV} must both be set`);
  }
  if (/[\u0000-\u001f\u007f]/.test(key) || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw new Error('Billetto API key pair is not valid');
  }
  return `${key}:${secret}`;
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

function sameHost(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.toLowerCase() === API_HOST;
}

function listUrl(url: URL): boolean {
  return sameHost(url) && url.pathname === API_PATH;
}

function httpsUrl(value: unknown): string | undefined {
  const raw = textOf(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function rateLimitRemaining(response: Response): number | undefined {
  const raw = response.headers.get('x-ratelimit-remaining')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function retryAfterMs(response: Response, fallback: number): number {
  const raw = response.headers.get('retry-after')?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (seconds >= 0 && seconds <= 15 * 60) return seconds * 1000;
  }
  return fallback;
}

function currencyOf(value: unknown): string | undefined {
  const text = textOf(value)?.toUpperCase();
  return text && /^[A-Z]{3}$/.test(text) ? text : undefined;
}

/**
 * Live `amount_in_cents` matches the event page major price (165 is 165 SEK).
 * A decimal `amount` is the same major unit. The stored price is minor units.
 */
function minorPrice(value: unknown): { amount: number; currency?: string } | undefined {
  const record = recordOf(value);
  if (!record) return undefined;
  const currency = currencyOf(record.currency);
  const major = numberOf(record.amount_in_cents) ?? numberOf(record.amount);
  if (major == null || major < 0 || major > MAX_MAJOR) return undefined;
  const minor = Math.round(major * 100);
  if (minor > 10_000_000) return undefined;
  return { amount: minor, ...(currency ? { currency } : {}) };
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

function pointOf(
  latitude: number | undefined,
  longitude: number | undefined,
): { lat: number; lng: number } | undefined {
  if (latitude == null || longitude == null) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  if (latitude === 0 && longitude === 0) return undefined;
  return { lat: latitude, lng: longitude };
}

function prose(value: string): string {
  const $ = load(value);
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4').append('\n');
  const text = $('body').text();
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function ageLimitOf(description: string): number | undefined {
  const match = /åldersgräns\s*:?\s*(\d{1,3})|\bfrån\s+(\d{1,2})\s+år\b/iu.exec(description);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const age = Number(raw);
  return age >= 1 && age <= 120 ? age : undefined;
}

function hintsOf(value: unknown): string[] {
  const record = recordOf(value);
  if (!record) return [];
  const names = [
    record.category_localized,
    record.subcategory_localized,
    record.type_localized,
    record.localized_type,
  ];
  const hints: string[] = [];
  for (const name of names) {
    const text = textOf(name)?.slice(0, 120);
    if (!text || hints.includes(text)) continue;
    hints.push(text);
  }
  return hints.slice(0, 20);
}

function venueNameOf(
  name: string | undefined,
  street: string | undefined,
  city: string | undefined,
) {
  if (!name) return undefined;
  const trimmed = name.slice(0, 500);
  if (!trimmed) return undefined;
  const key = cityKey(trimmed);
  if (street && key === cityKey(street)) return undefined;
  if (city && key === cityKey(city)) return undefined;
  return trimmed;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  const text = textOf(value);
  return text && EVENT_ID.test(text) ? text : undefined;
}

/** One public event. A draft, a canceled event, and a row without a title are dropped. */
export function parseBillettoEvent(value: unknown): BillettoEvent | undefined {
  const record = recordOf(value);
  const id = idOf(record?.id);
  const title = textOf(record?.title) ?? textOf(record?.name);
  if (!record || !id || !title) return undefined;
  const state = textOf(record.state)?.toLowerCase();
  if (state && state !== 'published') return undefined;
  const location = recordOf(record.location);
  const organiser = recordOf(record.organiser) ?? recordOf(record.organizer);
  const price = minorPrice(record.minimum_price);
  const latitude = numberOf(recordOf(location?.coordinates)?.latitude);
  const longitude = numberOf(recordOf(location?.coordinates)?.longitude);
  const street = [textOf(location?.address_line), textOf(location?.address_line_2)]
    .filter(Boolean)
    .join(', ');
  const city = textOf(location?.city);
  const venueName = venueNameOf(textOf(location?.location_name), street || undefined, city);
  const description = textOf(record.description);
  const hints = hintsOf(record.categorization ?? record.categorisation);
  const url = httpsUrl(record.url);
  const imageUrl = httpsUrl(record.image_link);
  const postalCode = textOf(location?.postal_code);
  const countryRaw = textOf(location?.country_code)?.toUpperCase();
  const countryCode = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : undefined;
  const startsAt = instantOf(record.startdate ?? record.starts_at);
  const endsAt = instantOf(record.enddate ?? record.ends_at);
  const organizerId = idOf(organiser?.id);
  const organizerName = textOf(organiser?.name)?.slice(0, 200);
  return {
    id,
    title: title.slice(0, 300),
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(price
      ? { priceAmount: price.amount, ...(price.currency ? { currency: price.currency } : {}) }
      : {}),
    categoryHints: hints,
    ...(venueName ? { venueName } : {}),
    ...(street ? { street } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(city ? { city } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(latitude != null ? { latitude } : {}),
    ...(longitude != null ? { longitude } : {}),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(organizerId ? { organizerId } : {}),
    ...(organizerName ? { organizerName } : {}),
  };
}

function pageOf(value: unknown): BillettoPage {
  const body = recordOf(value);
  const rows = Array.isArray(body?.data) ? body.data : [];
  const events: BillettoEvent[] = [];
  for (const row of rows) {
    const event = parseBillettoEvent(row);
    if (event) events.push(event);
  }
  const nextUrl = httpsUrl(body?.next_url);
  const lastId = idOf(recordOf(rows.at(-1))?.id);
  return {
    events,
    rowCount: rows.length,
    hasMore: body?.has_more === true,
    ...(nextUrl ? { nextUrl } : {}),
    ...(lastId ? { lastId } : {}),
  };
}

function kept(event: BillettoEvent, cities: string[]): boolean {
  if (event.countryCode && event.countryCode !== 'SE') return false;
  return billettoCityMatches(event.city, cities);
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

export function mapBillettoEvent(event: BillettoEvent): IncomingEvent {
  const written = event.description ? prose(event.description).slice(0, 20_000) : '';
  let endsAt = event.endsAt;
  if (event.startsAt && endsAt && new Date(endsAt).getTime() < new Date(event.startsAt).getTime()) {
    endsAt = undefined;
  }
  const location = pointOf(event.latitude, event.longitude);
  const address = eventAddress({
    address: event.street,
    zipCode: event.postalCode,
    city: event.city,
    location,
  });
  const fromText = event.priceAmount == null ? priceAmountFromText(written) : undefined;
  const priceAmount = event.priceAmount ?? fromText;
  const currency = event.currency ?? (priceAmount !== undefined ? 'SEK' : undefined);
  const ageLimit = ageLimitOf(written);
  const meta: EventMeta = {};
  if (priceAmount === 0) meta.freeEntry = true;
  if (ageLimit !== undefined) meta.ageLimit = ageLimit;
  if (address) meta.address = address;
  const links: ImportEventLink[] = [];
  addLink(links, event.url, 'tickets', 'Billetto');
  const merged = mergeImportedLinks(links, written) ?? [];
  const sourceUrl = event.url ?? `${API_ORIGIN}/e/biljetter-${event.id}`;
  const place = [event.street, event.city].filter(Boolean).join(', ');
  return {
    externalId: event.id,
    title: event.title,
    ...(written ? { description: written } : {}),
    mode: 'physical',
    ...(event.startsAt ? { startsAt: event.startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    timezone: 'Europe/Stockholm',
    ...(event.venueName ? { venueName: event.venueName } : {}),
    ...(place ? { address: place } : {}),
    ...(location ? { location } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: currency ?? 'SEK' } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    ...(merged.length > 0 ? { links: merged } : {}),
    sourceUrl,
    organizerKeys: organizerKeys({
      ids: [event.organizerId],
      names: [event.organizerName],
      town: event.city,
      fallback: ORGANIZER_FALLBACK,
      skipHosts: [API_HOST, 'billetto.imgix.net'],
    }),
    ...(event.organizerName ? { organizerName: event.organizerName } : {}),
    ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
    categoryHints: event.categoryHints,
    tags: [],
  };
}

function firstPage(pageSize: number): URL {
  const url = new URL(API_PATH, API_ORIGIN);
  url.searchParams.set('limit', String(pageSize));
  return url;
}

function nextPage(page: BillettoPage, current: URL): URL | undefined {
  if (!page.hasMore || page.rowCount === 0) return undefined;
  let url: URL;
  if (page.nextUrl) {
    try {
      url = new URL(page.nextUrl);
    } catch {
      throw new Error('billetto next page is not a URL');
    }
    if (!listUrl(url)) throw new Error('billetto next page left billetto.se');
  } else if (page.lastId) {
    url = new URL(current);
    url.searchParams.set('after', page.lastId);
  } else {
    return undefined;
  }
  if (url.href === current.href) return undefined;
  return url;
}

async function readJson(
  ctx: SourceRunContext,
  url: URL,
  keypair: string,
  waitMs: number,
): Promise<{ body: unknown; remaining: number | undefined }> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await ctx.fetch(url, {
      headers: {
        Accept: 'application/json',
        'Api-Keypair': keypair,
        'Billetto-Version': API_VERSION,
      },
      redirect: 'error',
    });
    if (!sameHost(responseUrl(response, url))) {
      throw new Error('billetto request redirected off billetto.se');
    }
    const remaining = rateLimitRemaining(response);
    if (response.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error('Billetto API request failed (429)');
      }
      ctx.log('billetto rate limit', { remaining: remaining ?? null, retry: attempt + 1 });
      const pause = retryAfterMs(response, waitMs);
      if (pause > 0) await sleep(pause);
      continue;
    }
    if (!response.ok) throw new Error(`Billetto API request failed (${response.status})`);
    return { body: await response.json(), remaining };
  }
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<BillettoRaw> {
  const settings = settingsFromConfig(ctx.config);
  const keypair = apiKeypair();
  const seen = new Set<string>();
  let url = firstPage(settings.pageSize);
  let yielded = 0;
  let requests = 0;
  let remaining: number | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (ctx.limit != null && yielded >= ctx.limit) return;
    if (requests > 0 && remaining === 0 && settings.rateLimitWaitMs > 0) {
      await sleep(settings.rateLimitWaitMs);
    } else if (requests > 0 && settings.delayMs > 0) {
      await sleep(settings.delayMs);
    }
    requests += 1;
    const result = await readJson(ctx, url, keypair, settings.rateLimitWaitMs);
    remaining = result.remaining;
    const parsed = pageOf(result.body);
    for (const event of parsed.events) {
      if (ctx.limit != null && yielded >= ctx.limit) return;
      if (seen.has(event.id) || !kept(event, settings.cities)) continue;
      seen.add(event.id);
      yielded += 1;
      yield { events: [event] };
    }
    const next = nextPage(parsed, url);
    if (!next) break;
    url = next;
  }
  if (yielded === 0) throw new Error('billetto found no usable events');
}

export const billetto = defineAdapter<BillettoRaw>({
  slug: 'billetto',
  kind: 'api',
  each: eachEvent,
  async fetchRaw(ctx) {
    const events: BillettoEvent[] = [];
    for await (const raw of eachEvent(ctx)) events.push(...raw.events);
    return { events };
  },
  map(raw) {
    return raw.events.map((event) => mapBillettoEvent(event));
  },
});

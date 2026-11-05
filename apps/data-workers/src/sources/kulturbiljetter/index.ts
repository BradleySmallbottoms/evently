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
 * Kulturbiljetter Events API v3. The key is KULTURBILJETTER_API_KEY, never config.
 * The list has no city, so each event is fetched and kept when a showing is in a
 * configured city. One product is one event. Each date is an occasion.
 * A unix time is that instant. The API sends a start and no end, so both fields
 * are that instant: a whole day on that date. `date_only` is the same rule.
 * The import does not geocode. A redirect off kulturbiljetter.se fails that request.
 */

const API_ORIGIN = 'https://kulturbiljetter.se';
const API_HOST = 'kulturbiljetter.se';
const API_KEY_ENV = 'KULTURBILJETTER_API_KEY';
const DEFAULT_CITIES = ['Söderhamn', 'Bollnäs', 'Hudiksvall', 'Ljusdal'];
const ORGANIZER_FALLBACK = 'kulturbiljetter';
const MAX_MAJOR = 100_000;
const EVENT_ID = /^\d{1,12}$/;

export interface KulturbiljetterDate {
  dateId: string;
  locationId?: string;
  startsAt?: string;
  checkoutUrl?: string;
}

export interface KulturbiljetterLocation {
  locationId: string;
  name?: string;
  street?: string;
  vicinity?: string;
  city?: string;
}

export interface KulturbiljetterEvent {
  id: string;
  title: string;
  shortHtml?: string;
  longHtml?: string;
  priceMin?: number;
  organizerId?: string;
  organizerName?: string;
  images: string[];
  dates: KulturbiljetterDate[];
  locations: KulturbiljetterLocation[];
  checkoutUrl?: string;
  eventUrl?: string;
}

export interface KulturbiljetterRaw {
  events: KulturbiljetterEvent[];
}

interface KulturbiljetterSettings {
  cities: string[];
  delayMs: number;
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

function indexed(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = recordOf(value);
  if (!record) return [];
  return Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => record[key]);
}

function idOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  const text = textOf(value);
  return text && EVENT_ID.test(text) ? text : undefined;
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

function cityKey(city: string): string {
  return city.trim().toLocaleLowerCase('sv');
}

/** A venue city matches a configured city. An empty city does not: the list is national. */
export function kulturbiljetterCityMatches(city: string | undefined, allowed: string[]): boolean {
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
    throw new Error('kulturbiljetter config.cities must be 1–12 city names');
  }
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!/^[\p{L}][\p{L} .'-]{0,40}$/u.test(name)) {
      throw new Error('kulturbiljetter config.cities must be city names');
    }
    const key = name.toLocaleLowerCase('sv');
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(name);
  }
  if (cities.length === 0) throw new Error('kulturbiljetter config.cities must be 1–12 city names');
  return cities;
}

function delayMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.delayMs ?? 200;
  const delay = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) return 200;
  return delay;
}

function settingsFromConfig(config: Record<string, unknown>): KulturbiljetterSettings {
  return {
    cities: citiesFromConfig(config),
    delayMs: delayMsFromConfig(config),
  };
}

function apiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) throw new Error(`${API_KEY_ENV} is not set`);
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

function sameHost(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.toLowerCase() === API_HOST;
}

function instantOf(value: unknown): string | undefined {
  const seconds =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : undefined;
  if (seconds == null || seconds < 1_000_000_000 || seconds > 4_000_000_000) return undefined;
  return sourceDateTime(new Date(seconds * 1000).toISOString());
}

function minorUnits(value: unknown): number | undefined {
  if (value == null) return undefined;
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : textOf(value)?.replace(',', '.');
  if (!text || !/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return undefined;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > MAX_MAJOR) return undefined;
  const minor = Math.round(amount * 100);
  return minor <= 10_000_000 ? minor : undefined;
}

function prose(html: string): string {
  const $ = load(html);
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4').append('\n');
  return $('body')
    .text()
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

function parseDate(value: unknown): KulturbiljetterDate | undefined {
  const record = recordOf(value);
  const dateId = idOf(record?.date_id);
  if (!record || !dateId) return undefined;
  const startsAt = instantOf(record.unixtime_start);
  return {
    dateId,
    ...(idOf(record.location_id) ? { locationId: idOf(record.location_id) } : {}),
    ...(startsAt ? { startsAt } : {}),
    ...(httpsUrl(record.url_checkout) ? { checkoutUrl: httpsUrl(record.url_checkout) } : {}),
  };
}

function parseLocation(value: unknown): KulturbiljetterLocation | undefined {
  const record = recordOf(value);
  const locationId = idOf(record?.location_id);
  if (!record || !locationId) return undefined;
  const name = textOf(record.name);
  const street = textOf(record.street);
  const vicinity = textOf(record.vicinity);
  const city = textOf(record.city);
  return {
    locationId,
    ...(name ? { name } : {}),
    ...(street ? { street } : {}),
    ...(vicinity ? { vicinity } : {}),
    ...(city ? { city } : {}),
  };
}

export function parseKulturbiljetterEvent(
  value: unknown,
  eventId: string,
): KulturbiljetterEvent | undefined {
  const record = recordOf(value);
  const title = textOf(record?.title);
  if (!record || !title || !EVENT_ID.test(eventId)) return undefined;
  const organizer = recordOf(record.organizer);
  const images = [
    ...new Set(
      indexed(record.images)
        .map((item) => httpsUrl(item))
        .filter((item) => item != null),
    ),
  ];
  const priceMin = minorUnits(record.price_min) ?? minorUnits(record.price_max);
  const organizerName = textOf(organizer?.name);
  const shortHtml = textOf(record.presentation_short);
  const longHtml = textOf(record.presentation_long);
  const checkoutUrl = httpsUrl(record.url_checkout);
  const eventUrl = httpsUrl(record.url_event_page);
  return {
    id: eventId,
    title,
    ...(shortHtml ? { shortHtml } : {}),
    ...(longHtml ? { longHtml } : {}),
    ...(priceMin !== undefined ? { priceMin } : {}),
    ...(idOf(organizer?.organizer_id) ? { organizerId: idOf(organizer?.organizer_id) } : {}),
    ...(organizerName ? { organizerName } : {}),
    images,
    dates: indexed(record.dates).flatMap((item) => {
      const date = parseDate(item);
      return date ? [date] : [];
    }),
    locations: indexed(record.locations).flatMap((item) => {
      const location = parseLocation(item);
      return location ? [location] : [];
    }),
    ...(checkoutUrl ? { checkoutUrl } : {}),
    ...(eventUrl ? { eventUrl } : {}),
  };
}

function locationFor(
  event: KulturbiljetterEvent,
  locationId: string | undefined,
): KulturbiljetterLocation | undefined {
  if (locationId) return event.locations.find((location) => location.locationId === locationId);
  return event.locations.length === 1 ? event.locations[0] : undefined;
}

/** Drops showings outside the configured cities. An event with none of them is omitted. */
export function kulturbiljetterLocalEvent(
  event: KulturbiljetterEvent,
  cities: string[],
): KulturbiljetterEvent | undefined {
  const dates = event.dates.filter((date) => {
    const location = locationFor(event, date.locationId);
    return kulturbiljetterCityMatches(location?.city, cities);
  });
  if (event.dates.length > 0 && dates.length === 0) return undefined;
  const locations =
    dates.length > 0
      ? event.locations.filter((location) =>
          dates.some((date) => {
            const match = locationFor(event, date.locationId);
            return match?.locationId === location.locationId;
          }),
        )
      : event.locations.filter((location) => kulturbiljetterCityMatches(location.city, cities));
  if (dates.length === 0 && locations.length === 0) return undefined;
  return { ...event, dates, locations };
}

function sharedValue(values: Array<string | undefined>): string | undefined {
  const names = [...new Set(values.filter((value) => value != null))];
  return names.length === 1 ? names[0] : undefined;
}

function writtenDescription(event: KulturbiljetterEvent): { text?: string; raw: string } {
  const long = event.longHtml ?? '';
  const short = event.shortHtml ?? '';
  const raw = long && short && !long.includes(short) ? `${short}\n${long}` : long || short;
  const text = prose(raw).slice(0, 20_000);
  return text ? { text, raw } : { raw };
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

export function mapKulturbiljetterEvent(event: KulturbiljetterEvent): IncomingEvent {
  const written = writtenDescription(event);
  const occasions = event.dates.flatMap((date) => {
    if (!date.startsAt) return [];
    const location = locationFor(event, date.locationId);
    const venueName = location?.name;
    return [
      {
        startsAt: date.startsAt,
        endsAt: date.startsAt,
        ...(venueName ? { venueName } : {}),
        sourceKey: date.dateId,
      },
    ];
  });
  occasions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const usedLocations = event.locations.filter((location) =>
    event.dates.some(
      (date) => locationFor(event, date.locationId)?.locationId === location.locationId,
    ),
  );
  const places = usedLocations.length > 0 ? usedLocations : event.locations;
  const venueName = sharedValue(places.map((location) => location.name));
  const street = sharedValue(
    places.map((location) =>
      [location.street, !location.street ? location.vicinity : undefined]
        .filter(Boolean)
        .join(', '),
    ),
  );
  const city = sharedValue(places.map((location) => location.city));
  const address = eventAddress({
    ...(street ? { address: street } : {}),
    ...(city ? { city } : {}),
  });
  const parsedText = priceAmountFromText(written.text);
  const priceAmount = event.priceMin !== undefined ? event.priceMin : parsedText;
  const free = priceAmount === 0;
  const ageLimit = ageLimitOf(written.text ?? '');
  const meta: EventMeta = {};
  if (free) meta.freeEntry = true;
  if (ageLimit !== undefined) meta.ageLimit = ageLimit;
  if (address) meta.address = address;
  const links: ImportEventLink[] = [];
  addLink(
    links,
    event.checkoutUrl ?? event.dates.find((date) => date.checkoutUrl)?.checkoutUrl,
    'tickets',
    'Kulturbiljetter',
  );
  addLink(links, event.eventUrl, 'info');
  const merged = mergeImportedLinks(links, written.raw) ?? [];
  const sourceUrl = event.eventUrl ?? `${API_ORIGIN}/evenemang/${event.id}/`;
  const place = [street, city].filter(Boolean).join(', ');
  const first = occasions[0];
  const last = occasions.at(-1);
  const images = event.images.slice(0, 9);
  return {
    externalId: event.id,
    title: event.title,
    ...(written.text ? { description: written.text } : {}),
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
    sourceUrl,
    organizerKeys: organizerKeys({
      ids: [event.organizerId],
      names: [event.organizerName],
      town: city,
      fallback: ORGANIZER_FALLBACK,
      skipHosts: [API_HOST],
    }),
    ...(event.organizerName ? { organizerName: event.organizerName } : {}),
    ...(images[0] ? { imageUrl: images[0] } : {}),
    ...(images.length > 1 ? { imageUrls: images.slice(1, 9) } : {}),
    categoryHints: [],
    tags: [],
  };
}

async function readJson(ctx: SourceRunContext, url: URL, key: string): Promise<unknown> {
  const response = await ctx.fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Token ${key}` },
    redirect: 'error',
  });
  if (!sameHost(responseUrl(response, url))) {
    throw new Error('kulturbiljetter request redirected off kulturbiljetter.se');
  }
  if (response.status === 404) {
    const error = new Error('kulturbiljetter event was not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (!response.ok) throw new Error(`Kulturbiljetter API request failed (${response.status})`);
  return response.json();
}

function httpStatus(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

function listEntries(value: unknown): { id: string }[] {
  const entries: { id: string }[] = [];
  const seen = new Set<string>();
  for (const item of indexed(value)) {
    const record = recordOf(item);
    const id = idOf(record?.event_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id });
  }
  return entries;
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<KulturbiljetterRaw> {
  const settings = settingsFromConfig(ctx.config);
  const key = apiKey();
  let requests = 0;
  let yielded = 0;

  const load = async (url: URL): Promise<unknown> => {
    if (requests > 0 && settings.delayMs > 0) await sleep(settings.delayMs);
    requests += 1;
    return readJson(ctx, url, key);
  };

  const list = listEntries(await load(new URL('/api/v3/events/', API_ORIGIN)));
  for (const entry of list) {
    if (ctx.limit != null && yielded >= ctx.limit) break;
    let payload: unknown;
    try {
      payload = await load(new URL(`/api/v3/events/${entry.id}`, API_ORIGIN));
    } catch (error) {
      if (httpStatus(error) === 404) {
        ctx.log('kulturbiljetter skipped a missing event', { id: entry.id });
        continue;
      }
      throw error;
    }
    const parsed = parseKulturbiljetterEvent(payload, entry.id);
    if (!parsed) {
      ctx.log('kulturbiljetter skipped an unreadable event', { id: entry.id });
      continue;
    }
    const local = kulturbiljetterLocalEvent(parsed, settings.cities);
    if (!local) continue;
    yielded += 1;
    yield { events: [local] };
  }
  if (yielded === 0) throw new Error('kulturbiljetter found no usable events');
}

export const kulturbiljetter = defineAdapter<KulturbiljetterRaw>({
  slug: 'kulturbiljetter',
  kind: 'api',
  each: eachEvent,
  async fetchRaw(ctx) {
    const events: KulturbiljetterEvent[] = [];
    for await (const raw of eachEvent(ctx)) events.push(...raw.events);
    return { events };
  },
  map(raw) {
    return raw.events.map((event) => mapKulturbiljetterEvent(event));
  },
});

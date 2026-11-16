import { gunzipSync } from 'node:zlib';
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

/**
 * Tickster Event Dump, path version 1.0. The key is TICKSTER_API_KEY, never config.
 * One daily file of every upcoming event, then the showings in the configured cities.
 * The file uses the older event shape (start, goods, infoUri), not Event API field names.
 * A production or collection is the parent of its showings, so it is skipped.
 * Each showing is one event. A time with an offset is that instant. The import does not geocode.
 * `TICKSTER_STOP_ON_403` stops on a 403 from the dump pointer instead of failing the run.
 */

const API_ORIGIN = 'https://api.tickster.com';
const API_KEY_ENV = 'TICKSTER_API_KEY';
const DEFAULT_CITIES = ['Söderhamn', 'Bollnäs', 'Hudiksvall', 'Ljusdal'];
const DEFAULT_LANGUAGE = 'sv';
const MAX_MAJOR = 100_000;
const ORGANIZER_FALLBACK = 'tickster';
const LANGUAGES = new Set(['sv', 'en', 'nb', 'da']);
const SKIP_HIERARCHY = new Set(['production', 'collection']);
const SKIP_STATE = new Set(['cancelled', 'notreleased', 'undefined', 'releasedfornonpublicsale']);
const TICKET_TYPES = new Set(['ticket', 'numberedticket', 'package']);
const EVENT_ID = /^[A-Za-z0-9_-]{4,80}$/;
/** The live file is about 50 MB. Leave room for growth, and stop a gzip bomb. */
const MAX_DUMP_BYTES = 128 * 1024 * 1024;

export interface TicksterPrice {
  amount: number;
  currency: string;
}

export interface TicksterProduct {
  productType?: string;
  price?: TicksterPrice;
  variants: TicksterPrice[];
}

export interface TicksterLink {
  url: string;
  text?: string;
}

export interface TicksterEvent {
  id: string;
  name: string;
  descriptionHtml?: string;
  descriptionMarkdown?: string;
  ageLimit?: string;
  accessibilityInfo?: string;
  startUtc?: string;
  endUtc?: string;
  state?: string;
  imageUrl?: string;
  infoUrl?: string;
  shopUrl?: string;
  eventHierarchyType?: string;
  organizerId?: string;
  organizerName?: string;
  venueName?: string;
  venueAddress?: string;
  venueZip?: string;
  venueCity?: string;
  venueCountry?: string;
  latitude?: number;
  longitude?: number;
  tags: string[];
  webLinks: TicksterLink[];
  products: TicksterProduct[];
}

export interface TicksterOrganizer {
  id?: string;
  name?: string;
  website?: string;
  email?: string;
  facebook?: string;
  instagram?: string;
}

export interface TicksterParsed {
  event: TicksterEvent;
  organizer?: TicksterOrganizer;
}

export interface TicksterRaw {
  events: TicksterParsed[];
}

interface TicksterSettings {
  cities: string[];
  language: string;
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
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function citiesFromConfig(config: Record<string, unknown>): string[] {
  const raw = config.cities ?? DEFAULT_CITIES;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) {
    throw new Error('tickster config.cities must be 1–12 city names');
  }
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!/^[\p{L}][\p{L} .'-]{0,40}$/u.test(name)) {
      throw new Error('tickster config.cities must be city names');
    }
    const key = name.toLocaleLowerCase('sv');
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(name);
  }
  if (cities.length === 0) throw new Error('tickster config.cities must be 1–12 city names');
  return cities;
}

function languageFromConfig(config: Record<string, unknown>): string {
  const raw = textOf(config.language) ?? DEFAULT_LANGUAGE;
  if (!LANGUAGES.has(raw)) throw new Error('tickster config.language must be sv, en, nb, or da');
  return raw;
}

function settingsFromConfig(config: Record<string, unknown>): TicksterSettings {
  return {
    cities: citiesFromConfig(config),
    language: languageFromConfig(config),
  };
}

function apiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) throw new Error(`${API_KEY_ENV} is not set`);
  return key;
}

function pointerUrl(language: string, key: string): URL {
  const url = new URL(`/${language}/api/1.0/events/dump/upcoming`, API_ORIGIN);
  url.searchParams.set('key', key);
  return url;
}

function responseUrl(response: Response, fallback: URL): URL {
  try {
    return new URL(response.url || fallback);
  } catch {
    return fallback;
  }
}

/** The signed dump object lives on this bucket, including a regional host. */
function dumpFileHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'event-api-dumps.s3.amazonaws.com') return true;
  return /^event-api-dumps\.s3[.-][a-z]{2}-[a-z0-9]+-\d+\.amazonaws\.com$/.test(host);
}

function dumpFileUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!dumpFileHost(url.hostname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function failedRequest(status: number): Error & { status?: number } {
  const error = new Error(`Tickster API request failed (${status})`) as Error & { status?: number };
  error.status = status;
  return error;
}

/** The test ingest script sets this so a blocked Tickster run does not hold the next source. */
function stopOn403(): boolean {
  const value = process.env.TICKSTER_STOP_ON_403?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

class TicksterStop extends Error {
  readonly status: number | undefined;

  constructor(status?: number) {
    super(status == null ? 'Tickster stopped' : `Tickster stopped (${status})`);
    this.name = 'TicksterStop';
    this.status = status;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DUMP_BYTES) throw new Error('tickster dump is too large');
  const payload =
    bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes, { maxOutputLength: MAX_DUMP_BYTES })
      : bytes;
  return JSON.parse(payload.toString('utf8'));
}

function stayedOn(response: Response, expected: URL, message: string): void {
  const url = responseUrl(response, expected);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(message);
  if (url.hostname.toLowerCase() !== expected.hostname.toLowerCase()) throw new Error(message);
}

function errorText(error: unknown): string {
  if (error == null || typeof error !== 'object') return error == null ? '' : String(error);
  const message = error instanceof Error ? error.message : '';
  const cause = 'cause' in error ? errorText((error as { cause?: unknown }).cause) : '';
  return cause ? `${message}\n${cause}` : message;
}

/** A failed fetch can include the request URL. The pointer carries the API key, and the file URL is signed. */
function quietError(error: unknown, secrets: string[]): Error {
  const message = errorText(error);
  if (secrets.some((secret) => secret.length > 0 && message.includes(secret))) {
    return new Error('tickster request failed');
  }
  return error instanceof Error ? error : new Error(message);
}

async function load(
  ctx: SourceRunContext,
  url: URL,
  init: RequestInit,
  secrets: string[],
): Promise<Response> {
  try {
    return await ctx.fetch(url, init);
  } catch (error) {
    throw quietError(error, secrets);
  }
}

function httpsUrl(value: unknown): string | undefined {
  const raw = textOf(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function priceOf(value: unknown): TicksterPrice | undefined {
  const body = recordOf(value);
  const amount = numberOf(body?.amount);
  if (amount == null || amount < 0 || amount > MAX_MAJOR) return undefined;
  const currency = textOf(body?.currency);
  return {
    amount,
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'SEK',
  };
}

function descriptionOf(value: unknown): { html?: string; markdown?: string } {
  if (typeof value === 'string') {
    const html = textOf(value);
    return html ? { html } : {};
  }
  const body = recordOf(value);
  if (!body) return {};
  const html = textOf(body.html);
  const markdown = textOf(body.markdown);
  return {
    ...(html ? { html } : {}),
    ...(markdown ? { markdown } : {}),
  };
}

export function parseTicksterEvent(value: unknown): TicksterEvent | undefined {
  const body = recordOf(value);
  const id = textOf(body?.id);
  const name = textOf(body?.name);
  if (!body || !id || !name || !EVENT_ID.test(id)) return undefined;
  const description = descriptionOf(body.description);
  const descriptionHtml = description.html;
  const descriptionMarkdown = description.markdown;
  const organizer = recordOf(body.organizer);
  const venue = recordOf(body.venue);
  const geo = recordOf(venue?.geo);
  const tags = Array.isArray(body.tags)
    ? body.tags.flatMap((tag) => {
        const nameOfTag = textOf(tag);
        return nameOfTag ? [nameOfTag] : [];
      })
    : [];
  const webLinks = Array.isArray(body.webLinks)
    ? body.webLinks.flatMap((link) => {
        const item = recordOf(link);
        const url = httpsUrl(item?.url);
        if (!url) return [];
        const label = textOf(item?.text);
        return [label ? { url, text: label } : { url }];
      })
    : [];
  const products = Array.isArray(body.products)
    ? body.products.flatMap((product) => {
        const item = recordOf(product);
        if (!item) return [];
        const variants = Array.isArray(item.variants)
          ? item.variants.flatMap((variant) => {
              const price = priceOf(recordOf(variant)?.price);
              return price ? [price] : [];
            })
          : [];
        const productType = textOf(item.productType);
        const price = priceOf(item.price);
        return [
          {
            ...(productType ? { productType } : {}),
            ...(price ? { price } : {}),
            variants,
          },
        ];
      })
    : [];
  const latitude = numberOf(geo?.latitude);
  const longitude = numberOf(geo?.longitude);
  const state = textOf(body.state);
  const ageLimit = textOf(body.ageLimit);
  const accessibilityInfo = textOf(body.accessibilityInfo);
  const startUtc = textOf(body.startUtc);
  const endUtc = textOf(body.endUtc);
  const hierarchy = textOf(body.eventHierarchyType);
  const organizerId = textOf(organizer?.id);
  const organizerName = textOf(organizer?.name);
  const venueName = textOf(venue?.name);
  const venueAddress = textOf(venue?.address);
  const venueZip = textOf(venue?.zipCode);
  const venueCity = textOf(venue?.city);
  const venueCountry = textOf(venue?.country);
  const imageUrl = httpsUrl(body.imageUrl);
  const infoUrl = httpsUrl(body.infoUrl);
  const shopUrl = httpsUrl(body.shopUrl);
  return {
    id,
    name,
    ...(descriptionHtml ? { descriptionHtml } : {}),
    ...(descriptionMarkdown ? { descriptionMarkdown } : {}),
    ...(ageLimit ? { ageLimit } : {}),
    ...(accessibilityInfo ? { accessibilityInfo } : {}),
    ...(startUtc ? { startUtc } : {}),
    ...(endUtc ? { endUtc } : {}),
    ...(state ? { state } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(infoUrl ? { infoUrl } : {}),
    ...(shopUrl ? { shopUrl } : {}),
    ...(hierarchy ? { eventHierarchyType: hierarchy } : {}),
    ...(organizerId ? { organizerId } : {}),
    ...(organizerName ? { organizerName } : {}),
    ...(venueName ? { venueName } : {}),
    ...(venueAddress ? { venueAddress } : {}),
    ...(venueZip ? { venueZip } : {}),
    ...(venueCity ? { venueCity } : {}),
    ...(venueCountry ? { venueCountry } : {}),
    ...(latitude != null ? { latitude } : {}),
    ...(longitude != null ? { longitude } : {}),
    tags: tags.slice(0, 20),
    webLinks: webLinks.slice(0, 10),
    products,
  };
}

function socialUrl(value: unknown, kind: 'facebook' | 'instagram'): string | undefined {
  const url = httpsUrl(value);
  if (!url) return undefined;
  return socialKind(url) === kind ? url : undefined;
}

export function parseTicksterOrganizer(value: unknown): TicksterOrganizer | undefined {
  const body = recordOf(value);
  if (!body) return undefined;
  const social = recordOf(body.socialMedia) ?? recordOf(body.social);
  const id = textOf(body.id);
  const name = textOf(body.name);
  const website = httpsUrl(body.website);
  const email = textOf(body.email);
  const facebook = socialUrl(social?.facebook, 'facebook');
  const instagram = socialUrl(social?.instagram, 'instagram');
  if (!id && !name && !website && !email && !facebook && !instagram) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(website ? { website } : {}),
    ...(email ? { email } : {}),
    ...(facebook ? { facebook } : {}),
    ...(instagram ? { instagram } : {}),
  };
}

function cityKey(value: string): string {
  return value.trim().toLocaleLowerCase('sv');
}

/** A venue city matches a configured city. The dump is national, so an empty city is dropped. */
export function ticksterCityMatches(city: string | undefined, allowed: string[]): boolean {
  if (!city?.trim()) return false;
  const key = cityKey(city);
  return allowed.some((name) => {
    const allowedKey = cityKey(name);
    return (
      key === allowedKey || key.startsWith(`${allowedKey} `) || key.startsWith(`${allowedKey},`)
    );
  });
}

function countryAllowed(country: string | undefined): boolean {
  if (!country) return true;
  const key = country.trim().toLocaleLowerCase('sv');
  return key === 'se' || key === 'swe' || key === 'sweden' || key === 'sverige';
}

export function ticksterShowing(event: TicksterEvent, cities: string[]): boolean {
  const hierarchy = event.eventHierarchyType?.toLocaleLowerCase('sv');
  if (hierarchy && SKIP_HIERARCHY.has(hierarchy)) return false;
  const state = event.state?.toLocaleLowerCase('sv');
  if (state && SKIP_STATE.has(state)) return false;
  if (!countryAllowed(event.venueCountry)) return false;
  return ticksterCityMatches(event.venueCity, cities);
}

function prose(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\/?[a-z0-9]+\]/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function instantOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return sourceDateTime(value);
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
  // Tickster sends 0, 0 when the venue has no coordinates.
  if (latitude === 0 && longitude === 0) return undefined;
  return { lat: latitude, lng: longitude };
}

function ageLimitOf(stated: string | undefined, description: string): number | undefined {
  const fromField = /^(\d{1,3})\b/.exec(stated ?? '');
  const fromText = /åldersgräns\s*:?\s*(\d{1,3})|\bfrån\s+(\d{1,2})\s+år\b/iu.exec(description);
  const raw = fromField?.[1] ?? fromText?.[1] ?? fromText?.[2];
  if (!raw) return undefined;
  const age = Number(raw);
  return age >= 1 && age <= 120 ? age : undefined;
}

function ticketPrice(event: TicksterEvent): TicksterPrice | undefined {
  const prices: TicksterPrice[] = [];
  for (const product of event.products) {
    const type = product.productType?.toLocaleLowerCase('sv');
    if (!type || !TICKET_TYPES.has(type)) continue;
    for (const price of [product.price, ...product.variants]) {
      if (!price) continue;
      prices.push({ amount: Math.round(price.amount * 100), currency: price.currency });
    }
  }
  const positive = prices.filter((price) => price.amount > 0);
  const pool = positive.length > 0 ? positive : prices.filter((price) => price.amount === 0);
  if (pool.length === 0) return undefined;
  return pool.reduce((lowest, price) => (price.amount < lowest.amount ? price : lowest));
}

function socialKind(url: string): 'facebook' | 'instagram' | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  } catch {
    return undefined;
  }
  return undefined;
}

function linkType(url: string, infoUrl: string | undefined): ImportEventLink['type'] {
  const social = socialKind(url);
  if (social) return social;
  if (infoUrl && eventUrlKey(url) === eventUrlKey(infoUrl)) return 'info';
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'tickster.com' || host.endsWith('.tickster.com')) return 'tickets';
  } catch {
    return 'info';
  }
  return 'info';
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
  const text = label?.replace(/\s+/g, ' ').trim();
  const next = text && !/^https?:\/\//i.test(text) ? text.slice(0, 80) : undefined;
  const kind = socialKind(key) ?? type;
  links.push(next ? { type: kind, url: key, label: next } : { type: kind, url: key });
}

function linksFor(
  event: TicksterEvent,
  organizer: TicksterOrganizer | undefined,
  raw: string,
): ImportEventLink[] {
  const links: ImportEventLink[] = [];
  addLink(links, event.shopUrl, 'tickets', 'Tickster');
  addLink(links, event.infoUrl, 'info');
  addLink(links, organizer?.website, 'info', organizer?.name);
  addLink(links, organizer?.facebook, 'facebook');
  addLink(links, organizer?.instagram, 'instagram');
  for (const link of event.webLinks)
    addLink(links, link.url, linkType(link.url, event.infoUrl), link.text);
  return mergeImportedLinks(links, raw) ?? [];
}

function writtenDescription(event: TicksterEvent): { text?: string; raw: string } {
  const rawBody = event.descriptionHtml || event.descriptionMarkdown || '';
  const access = event.accessibilityInfo ?? '';
  const raw = access && !rawBody.includes(access) ? `${rawBody}\n\n${access}` : rawBody;
  const text = prose(raw).slice(0, 20_000);
  return text ? { text, raw } : { raw };
}

export function mapTicksterEvent(parsed: TicksterParsed): IncomingEvent {
  const { event } = parsed;
  const organizer = parsed.organizer;
  const written = writtenDescription(event);
  const startsAt = instantOf(event.startUtc);
  let endsAt = instantOf(event.endUtc);
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    endsAt = undefined;
  }
  const location = pointOf(event.latitude, event.longitude);
  const address = eventAddress({
    address: event.venueAddress,
    zipCode: event.venueZip,
    city: event.venueCity,
    location,
  });
  const ticket = ticketPrice(event);
  const parsedText = priceAmountFromText(written.text);
  const priceAmount = ticket ? ticket.amount : parsedText;
  const currency = ticket?.currency ?? (priceAmount !== undefined ? 'SEK' : undefined);
  const free = priceAmount === 0;
  const ageLimit = ageLimitOf(event.ageLimit, written.text ?? '');
  const meta: EventMeta = {};
  if (free) meta.freeEntry = true;
  if (ageLimit !== undefined) meta.ageLimit = ageLimit;
  if (address) meta.address = address;
  const links = linksFor(event, organizer, written.raw);
  const infoLinks = links.filter((link) => link.type === 'info').map((link) => link.url);
  const organizerName = organizer?.name ?? event.organizerName;
  const place = [event.venueAddress, event.venueCity].filter(Boolean).join(', ');
  const sourceUrl = event.infoUrl ?? `https://www.tickster.com/sv/events/${event.id}`;
  const hints = [...new Set(event.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
  return {
    externalId: event.id,
    title: event.name,
    ...(written.text ? { description: written.text } : {}),
    mode: 'physical',
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    timezone: 'Europe/Stockholm',
    ...(event.venueName ? { venueName: event.venueName } : {}),
    ...(place ? { address: place } : {}),
    ...(location ? { location } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: currency ?? 'SEK' } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    links,
    sourceUrl,
    organizerKeys: organizerKeys({
      ids: [organizer?.id ?? event.organizerId],
      emails: [organizer?.email],
      infoUrls: [organizer?.website, ...infoLinks],
      names: [organizerName],
      town: event.venueCity,
      fallback: ORGANIZER_FALLBACK,
      skipHosts: ['tickster.com', 'secure.tickster.com', 'static.tickster.com'],
    }),
    ...(organizerName ? { organizerName } : {}),
    ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
    categoryHints: hints,
    tags: [],
  };
}

function majorAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const amount = Number(value.trim());
  return Number.isFinite(amount) ? amount : undefined;
}

function goodsAmount(price: Record<string, unknown> | undefined): number | undefined {
  const stated = majorAmount(price?.includingVat);
  if (stated != null) return stated;
  const regions = Array.isArray(price?.priceRegions) ? price.priceRegions : [];
  const amounts = regions.flatMap((region) => {
    const amount = majorAmount(recordOf(region)?.includingVat);
    return amount == null ? [] : [amount];
  });
  const positive = amounts.filter((amount) => amount > 0);
  const pool = positive.length > 0 ? positive : amounts.filter((amount) => amount === 0);
  if (pool.length === 0) return undefined;
  return Math.min(...pool);
}

function productsFromGoods(goods: unknown): unknown[] {
  if (!Array.isArray(goods)) return [];
  return goods.flatMap((good) => {
    const item = recordOf(good);
    if (!item) return [];
    const amount = goodsAmount(recordOf(item.price));
    const currency = textOf(recordOf(item.price)?.currency);
    const productType = textOf(item.type);
    return [
      {
        ...(productType ? { productType } : {}),
        ...(amount != null ? { price: { amount, ...(currency ? { currency } : {}) } } : {}),
        variants: [],
      },
    ];
  });
}

function linksFromDump(links: unknown): unknown[] {
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    const item = recordOf(link);
    const url = textOf(item?.uri) ?? textOf(item?.url);
    if (!url) return [];
    const text = textOf(item?.text);
    return [text ? { url, text } : { url }];
  });
}

function indexById(values: unknown): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(values)) return indexed;
  for (const value of values) {
    const body = recordOf(value);
    const id = textOf(body?.id);
    if (!body || !id || indexed.has(id)) continue;
    indexed.set(id, body);
  }
  return indexed;
}

function venueRecord(
  event: Record<string, unknown>,
  venues: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const nested = recordOf(event.venue);
  const id = textOf(event.venueId) ?? textOf(nested?.id);
  const listed = id ? venues.get(id) : undefined;
  if (!nested) return listed;
  if (!listed) return nested;
  const nestedGeo = recordOf(nested.geo);
  const listedGeo = recordOf(listed.geo);
  const geo =
    numberOf(nestedGeo?.latitude) != null && numberOf(nestedGeo?.longitude) != null
      ? nestedGeo
      : listedGeo;
  return {
    ...listed,
    ...nested,
    name: textOf(nested.name) ?? listed.name,
    address: textOf(nested.address) ?? listed.address,
    zipCode: textOf(nested.zipCode) ?? listed.zipCode,
    city: textOf(nested.city) ?? listed.city,
    country: textOf(nested.country) ?? listed.country,
    ...(geo ? { geo } : {}),
  };
}

/** The dump file uses the older event names. Map them onto the shape `parseTicksterEvent` reads. */
function eventFromDump(
  value: Record<string, unknown>,
  venues: Map<string, Record<string, unknown>>,
): TicksterEvent | undefined {
  const published = value.published;
  const state =
    published === false ? 'notreleased' : (textOf(value.eventState) ?? textOf(value.state));
  const organizerId = textOf(value.organizerId) ?? textOf(recordOf(value.organizer)?.id);
  const venue = venueRecord(value, venues);
  const goods = value.goods;
  return parseTicksterEvent({
    id: value.id,
    name: value.name,
    description: value.description,
    startUtc: value.start ?? value.startUtc,
    endUtc: value.end ?? value.endUtc,
    ...(state ? { state } : {}),
    imageUrl: value.imageUrl,
    infoUrl: value.infoUri ?? value.infoUrl,
    shopUrl: value.shopUri ?? value.shopUrl,
    eventHierarchyType: value.hierarchyType ?? value.eventHierarchyType,
    ...(organizerId ? { organizer: { id: organizerId } } : {}),
    ...(venue ? { venue } : {}),
    tags: value.tags,
    webLinks: linksFromDump(value.links ?? value.webLinks),
    products: Array.isArray(goods) ? productsFromGoods(goods) : value.products,
  });
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const body = recordOf(item);
    return body ? [body] : [];
  });
}

function childrenOf(
  parent: Record<string, unknown>,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const parentId = textOf(parent.id);
  const nested = rowsOf(parent.childEvents);
  const linked = parentId
    ? rows.filter(
        (row) => textOf(row.productionParentId) === parentId && textOf(row.id) !== parentId,
      )
    : [];
  const merged = new Map<string, Record<string, unknown>>();
  for (const child of [...linked, ...nested]) {
    const id = textOf(child.id);
    if (!id) continue;
    const current = merged.get(id);
    merged.set(id, current ? { ...current, ...child } : child);
  }
  return [...merged.values()];
}

/** A showing keeps its own time and venue. Text, price, and image fall back to the parent. */
function hasTicketPrice(event: TicksterEvent): boolean {
  return event.products.some((product) => {
    const type = product.productType?.toLocaleLowerCase('sv');
    return !!type && TICKET_TYPES.has(type) && product.price != null;
  });
}

function withParentCopy(child: TicksterEvent, parent: TicksterEvent): TicksterEvent {
  return {
    ...child,
    ...(child.descriptionHtml || !parent.descriptionHtml
      ? {}
      : { descriptionHtml: parent.descriptionHtml }),
    ...(child.descriptionMarkdown || !parent.descriptionMarkdown
      ? {}
      : { descriptionMarkdown: parent.descriptionMarkdown }),
    ...(child.ageLimit || !parent.ageLimit ? {} : { ageLimit: parent.ageLimit }),
    ...(child.accessibilityInfo || !parent.accessibilityInfo
      ? {}
      : { accessibilityInfo: parent.accessibilityInfo }),
    ...(child.imageUrl || !parent.imageUrl ? {} : { imageUrl: parent.imageUrl }),
    ...(child.shopUrl || !parent.shopUrl ? {} : { shopUrl: parent.shopUrl }),
    ...(child.organizerId || !parent.organizerId ? {} : { organizerId: parent.organizerId }),
    ...(child.organizerName || !parent.organizerName
      ? {}
      : { organizerName: parent.organizerName }),
    tags: child.tags.length > 0 ? child.tags : parent.tags,
    products:
      hasTicketPrice(child) || parent.products.length === 0 ? child.products : parent.products,
    webLinks: child.webLinks.length > 0 ? child.webLinks : parent.webLinks,
  };
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<TicksterRaw> {
  const settings = settingsFromConfig(ctx.config);
  const key = apiKey();
  const seen = new Set<string>();
  let yielded = 0;

  const emit = (
    event: TicksterEvent,
    organizers: Map<string, Record<string, unknown>>,
  ): TicksterRaw | undefined => {
    if (seen.has(event.id) || !ticksterShowing(event, settings.cities)) return undefined;
    seen.add(event.id);
    yielded += 1;
    const organizer = parseTicksterOrganizer(organizers.get(event.organizerId ?? ''));
    if (organizer?.name && !event.organizerName) event.organizerName = organizer.name;
    return { events: [{ event, ...(organizer ? { organizer } : {}) }] };
  };

  try {
    const pointer = pointerUrl(settings.language, key);
    const pointerResponse = await load(
      ctx,
      pointer,
      {
        headers: { Accept: 'application/json', 'x-api-key': key },
        redirect: 'error',
      },
      [key, pointer.href],
    );
    stayedOn(pointerResponse, pointer, 'tickster request redirected off api.tickster.com');
    if (pointerResponse.status === 403 && stopOn403()) throw new TicksterStop(403);
    if (!pointerResponse.ok) throw failedRequest(pointerResponse.status);
    let listed: Record<string, unknown> | undefined;
    try {
      listed = recordOf(await readBody(pointerResponse));
    } catch (error) {
      throw quietError(error, [key, pointer.href]);
    }
    const fileUrl = dumpFileUrl(textOf(listed?.uri));
    if (!fileUrl) throw new Error('tickster dump file is not on the event dump bucket');
    const fileResponse = await load(ctx, fileUrl, { redirect: 'error' }, [key, fileUrl.href]);
    stayedOn(fileResponse, fileUrl, 'tickster dump file redirected off the event dump bucket');
    if (!fileResponse.ok) throw failedRequest(fileResponse.status);
    let dump: Record<string, unknown> | undefined;
    try {
      dump = recordOf(await readBody(fileResponse));
    } catch (error) {
      throw quietError(error, [key, fileUrl.href]);
    }
    const venues = indexById(dump?.venues);
    const organizers = indexById(dump?.organizers);
    const rows = rowsOf(dump?.events);
    const byId = indexById(rows);
    for (const row of rows) {
      if (ctx.limit != null && yielded >= ctx.limit) return;
      const id = textOf(row.id);
      if (!id || seen.has(id)) continue;
      const hierarchy = (
        textOf(row.hierarchyType) ?? textOf(row.eventHierarchyType)
      )?.toLocaleLowerCase('sv');
      if (hierarchy && SKIP_HIERARCHY.has(hierarchy)) {
        seen.add(id);
        const parent = eventFromDump(row, venues);
        for (const child of childrenOf(row, rows)) {
          if (ctx.limit != null && yielded >= ctx.limit) return;
          const showing = eventFromDump(child, venues);
          if (!showing) continue;
          const merged = parent ? withParentCopy(showing, parent) : showing;
          const raw = emit(merged, organizers);
          if (raw) yield raw;
          else seen.add(showing.id);
        }
        continue;
      }
      if (hierarchy === 'production-child') {
        const parentId = textOf(row.productionParentId);
        const parentRow = parentId ? byId.get(parentId) : undefined;
        const parentHierarchy = (
          textOf(parentRow?.hierarchyType) ?? textOf(parentRow?.eventHierarchyType)
        )?.toLocaleLowerCase('sv');
        if (parentHierarchy && SKIP_HIERARCHY.has(parentHierarchy)) continue;
      }
      const event = eventFromDump(row, venues);
      if (!event) continue;
      const raw = emit(event, organizers);
      if (raw) yield raw;
    }
  } catch (error) {
    if (!(error instanceof TicksterStop)) throw error;
    ctx.log('tickster stopped', { status: error.status ?? null });
    return;
  }
  if (yielded === 0) throw new Error('tickster found no usable events');
}

export const tickster = defineAdapter<TicksterRaw>({
  slug: 'tickster',
  kind: 'api',
  each: eachEvent,
  async fetchRaw(ctx) {
    const events: TicksterParsed[] = [];
    for await (const raw of eachEvent(ctx)) events.push(...raw.events);
    return { events };
  },
  map(raw) {
    return raw.events.map((parsed) => mapTicksterEvent(parsed));
  },
});

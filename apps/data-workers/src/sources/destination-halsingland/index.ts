import type { EventMeta } from '@local-events/contracts';
import {
  organizerKeys,
  parseLinksFromText,
  priceAmountFromText,
  stockholmWallTime,
} from '@local-events/domain';
import {
  defineAdapter,
  occasionCollapseFromConfig,
  shouldCollapseOccasions,
  withCollapsedSpan,
  withOccasionGroup,
  type IncomingEvent,
  type OccasionCollapseOptions,
  type SourceRunContext,
} from '@local-events/ingest';
import { HTTP1_HEADER } from '../../http1';

/**
 * Destination Hälsingland via the public Citybreak JSON the calendar page already loads.
 * No API key. List: GET /sv/se-och-gora/products?filter=c=4559.
 * Each product then reads /sv/product/productcontent and
 * /sv/se-gora/todobookingcontrolcontext. A dense run of daily opening hours becomes
 * one event. Span and coverage come from source config.
 * Raw samples of those three responses, for product 1960936, are products.json,
 * product-content.json and booking-context.json in this folder.
 */

const DEFAULT_ORIGIN = 'https://visit.destinationhalsingland.se';
const DEFAULT_LANGUAGE = 'sv';
const DEFAULT_FILTER = 'c=4559';
const DEFAULT_SORTING = 'st=a;so=a;split=hl';
const DEFAULT_PAGE_SIZE = 10;
/** Node's TLS fingerprint is challenged. These calls go through curl over HTTP/1.1. */
const CALENDAR_USER_AGENT = 'PostmanRuntime/2.11.0';
const MAX_LIST_PAGES = 40;
const SOURCE_SKIP_HOSTS = ['visit.destinationhalsingland.se', 'destinationhalsingland.se'];

export interface HalsinglandOccasion {
  date: string;
  start: string;
  end?: string;
  venue?: string;
}

export interface HalsinglandLink {
  type: 'tickets' | 'registration' | 'info';
  url: string;
  label?: string;
}

export interface HalsinglandProduct {
  id: string;
  title: string;
  sourceUrl: string;
  intro?: string;
  description?: string;
  town?: string;
  location?: { lat: number; lng: number };
  imageUrl?: string;
  imageUrls?: string[];
  priceText?: string;
  freeEntry?: boolean;
  ageLimit?: number;
  organizerKeys: string[];
  organizerName?: string;
  links: HalsinglandLink[];
  occasions: HalsinglandOccasion[];
}

export interface HalsinglandRaw {
  now: string;
  origin: string;
  products: HalsinglandProduct[];
}

interface ListItem {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  location?: unknown;
  coordinates?: unknown;
  introduction?: unknown;
  images?: unknown;
  attributes?: unknown;
  pricing?: unknown;
}

interface ContentBody {
  title?: unknown;
  location?: unknown;
  description?: unknown;
  introduction?: unknown;
  goodToKnow?: unknown;
  images?: unknown;
  attributes?: unknown;
}

interface BookingBody {
  price?: unknown;
  externalBookingUrl?: unknown;
  occasions?: unknown;
}

interface ResolvedOccasion {
  startsAt: string;
  endsAt?: string;
  day: string;
  venue?: string;
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
    throw new Error('destination-halsingland config.origin is not a URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || host !== 'visit.destinationhalsingland.se') {
    throw new Error(
      'destination-halsingland config.origin must be https://visit.destinationhalsingland.se',
    );
  }
  return new URL(`https://${host}`);
}

function languageFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.language === 'string' ? config.language.trim() : DEFAULT_LANGUAGE;
  if (!/^[a-z]{2}$/.test(raw)) {
    throw new Error('destination-halsingland config.language must be a two-letter code');
  }
  return raw;
}

function filterFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.filter === 'string' ? config.filter.trim() : DEFAULT_FILTER;
  if (!/^c=\d+(,\d+)*$/.test(raw)) {
    throw new Error('destination-halsingland config.filter must look like c=4559');
  }
  return raw;
}

function sortingFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.sorting === 'string' ? config.sorting.trim() : DEFAULT_SORTING;
  if (!/^[a-z0-9=;,._-]{1,80}$/i.test(raw)) {
    throw new Error('destination-halsingland config.sorting is not a calendar sort');
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

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number(code);
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      ) {
        return '';
      }
      return String.fromCodePoint(value);
    })
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function productIdOf(value: unknown): string | undefined {
  const text = textOf(value);
  const match = /^(?:todo-)?(\d+)$/.exec(text);
  return match?.[1];
}

/** Citybreak list coordinates are [longitude, latitude]. */
export function pointFromCoordinates(value: unknown): { lat: number; lng: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  const swapped = first >= 55 && first <= 70 && second >= 10 && second <= 25;
  const lng = swapped ? second : first;
  const lat = swapped ? first : second;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function httpsUrl(value: unknown, base?: URL): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function sourceUrlOf(value: unknown, origin: URL): string | undefined {
  const href = httpsUrl(value, origin);
  if (!href) return undefined;
  const url = new URL(href);
  if (url.hostname.toLowerCase() !== origin.hostname.toLowerCase()) return undefined;
  url.search = '';
  url.hash = '';
  return url.href;
}

function sameHost(origin: URL, url: URL): boolean {
  return url.hostname.toLowerCase() === origin.hostname.toLowerCase();
}

function responseUrl(response: Response, request: URL): URL {
  if (!response.url) return request;
  try {
    return new URL(response.url);
  } catch {
    return request;
  }
}

function imagesOf(value: unknown): { imageUrl?: string; imageUrls?: string[] } {
  if (!Array.isArray(value)) return {};
  const urls: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !('url' in item)) continue;
    const href = httpsUrl(item.url);
    if (!href || !href.startsWith('https:') || urls.includes(href)) continue;
    urls.push(href);
    if (urls.length >= 9) break;
  }
  const imageUrl = urls[0];
  if (!imageUrl) return {};
  return { imageUrl, imageUrls: urls.slice(1) };
}

function ageLimitOf(groups: unknown): number | undefined {
  const names: string[] = [];
  if (!Array.isArray(groups)) return undefined;
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    if ('name' in group && typeof group.name === 'string') names.push(group.name);
    if ('attributes' in group && Array.isArray(group.attributes)) {
      for (const attribute of group.attributes) {
        if (attribute && typeof attribute === 'object' && 'name' in attribute) {
          names.push(textOf(attribute.name));
        }
      }
    }
  }
  for (const name of names) {
    const match = /åldersgräns\s*(\d{1,3})/i.exec(name);
    if (!match) continue;
    const age = Number(match[1]);
    if (age >= 0 && age <= 120) return age;
  }
  return undefined;
}

function isFreeAdmission(name: string): boolean {
  const text = name
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:fritt inträde|fri entré|gratis inträde|gratis)[.!]?$/i.test(text);
}

function freeEntryOf(content: ContentBody | undefined): boolean {
  const groups = content?.goodToKnow;
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !('attributes' in group)) continue;
    if (!Array.isArray(group.attributes)) continue;
    for (const attribute of group.attributes) {
      if (!attribute || typeof attribute !== 'object' || !('name' in attribute)) continue;
      if (isFreeAdmission(textOf(attribute.name))) return true;
    }
  }
  return false;
}

function contentHtml(content: ContentBody | undefined): string {
  const parts: string[] = [];
  if (typeof content?.description === 'string') parts.push(content.description);
  if (typeof content?.introduction === 'string') parts.push(content.introduction);
  if (!Array.isArray(content?.goodToKnow)) return parts.join('\n');
  for (const group of content.goodToKnow) {
    if (!group || typeof group !== 'object' || !('attributes' in group)) continue;
    if (!Array.isArray(group.attributes)) continue;
    for (const attribute of group.attributes) {
      if (attribute && typeof attribute === 'object' && 'name' in attribute) {
        parts.push(textOf(attribute.name));
      }
    }
  }
  return parts.join('\n');
}

function linksOf(content: ContentBody | undefined, bookingUrl: unknown): HalsinglandLink[] {
  const links = parseLinksFromText(contentHtml(content)).map((link) => ({
    type: link.type,
    url: link.url,
    ...(link.label ? { label: link.label } : {}),
  }));
  const booking = httpsUrl(bookingUrl);
  if (booking?.startsWith('https:') && !links.some((link) => link.url === booking)) {
    links.unshift({ type: 'tickets', url: booking });
  }
  return links.slice(0, 10);
}

function emailOf(content: ContentBody | undefined): string | undefined {
  const match = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(
    contentHtml(content).replace(/<[^>]+>/g, ' '),
  );
  return match?.[0].toLowerCase();
}

function organizerOf(
  links: HalsinglandLink[],
  venue: string | undefined,
  town: string | undefined,
  email: string | undefined,
): { organizerKeys: string[]; organizerName?: string } {
  const arena = venue?.trim();
  const place =
    arena && town && arena.toLocaleLowerCase('sv').endsWith(`, ${town.toLocaleLowerCase('sv')}`)
      ? arena.slice(0, arena.length - town.length - 2).trim()
      : arena;
  const organizerName = place || undefined;
  return {
    organizerKeys: organizerKeys({
      emails: [email],
      infoUrls: links.filter((link) => link.type === 'info').map((link) => link.url),
      names: [organizerName],
      town,
      fallback: 'destination-halsingland',
      skipHosts: SOURCE_SKIP_HOSTS,
    }),
    ...(organizerName ? { organizerName } : {}),
  };
}

function priceTextOf(booking: BookingBody | undefined, item: ListItem): string | undefined {
  const bookingPrice =
    booking?.price && typeof booking.price === 'object' && 'priceAndCurrency' in booking.price
      ? textOf(booking.price.priceAndCurrency)
      : '';
  if (bookingPrice) return bookingPrice;
  const listPrice =
    item.pricing && typeof item.pricing === 'object' && 'priceAndCurrency' in item.pricing
      ? textOf(item.pricing.priceAndCurrency)
      : '';
  return listPrice || undefined;
}

function occasionsOf(booking: BookingBody | undefined): HalsinglandOccasion[] {
  if (!Array.isArray(booking?.occasions)) return [];
  const occasions: HalsinglandOccasion[] = [];
  for (const row of booking.occasions) {
    if (!row || typeof row !== 'object') continue;
    const date = 'date' in row ? textOf(row.date) : '';
    const period = 'period' in row ? textOf(row.period) : '';
    const venue = 'arena' in row ? textOf(row.arena) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const time = /(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/.exec(period);
    if (!time) continue;
    occasions.push({
      date,
      start: padTime(time[1]!),
      ...(time[2] ? { end: padTime(time[2]) } : {}),
      ...(venue ? { venue } : {}),
    });
  }
  return occasions;
}

function padTime(value: string): string {
  const [hour, minute] = value.split(':');
  return `${hour!.padStart(2, '0')}:${minute}`;
}

function normalizeProduct(
  item: ListItem,
  content: ContentBody | undefined,
  booking: BookingBody | undefined,
  origin: URL,
): HalsinglandProduct | undefined {
  const id = productIdOf(item.id);
  const title = plainText(content?.title) || textOf(item.name);
  const sourceUrl = sourceUrlOf(item.url, origin);
  const occasions = occasionsOf(booking);
  if (!id || !title || !sourceUrl || occasions.length === 0) return undefined;
  const town = textOf(content?.location) || textOf(item.location) || undefined;
  const location = pointFromCoordinates(item.coordinates);
  const pictures = imagesOf(content?.images ?? item.images);
  const intro = plainText(content?.introduction) || plainText(item.introduction) || undefined;
  const description = plainText(content?.description) || undefined;
  const freeEntry = freeEntryOf(content);
  const ageLimit =
    ageLimitOf(content?.attributes ?? item.attributes) ?? ageLimitOf(item.attributes);
  const links = linksOf(content, booking?.externalBookingUrl);
  const venue = occasions.find((occasion) => occasion.venue)?.venue;
  const organizer = organizerOf(links, venue, town, emailOf(content));
  const priceText = priceTextOf(booking, item);
  return {
    id,
    title,
    sourceUrl,
    ...(intro ? { intro } : {}),
    ...(description ? { description } : {}),
    ...(town ? { town } : {}),
    ...(location ? { location } : {}),
    ...pictures,
    ...(priceText ? { priceText } : {}),
    ...(freeEntry ? { freeEntry } : {}),
    ...(ageLimit !== undefined ? { ageLimit } : {}),
    ...organizer,
    links,
    occasions,
  };
}

function withStockholmOffset(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return stockholmWallTime({
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    minute: minute!,
  });
}

function clockMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day! + 1));
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(utc.getUTCDate()).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${nextMonth}-${nextDay}`;
}

function resolveOccasions(product: HalsinglandProduct): ResolvedOccasion[] {
  return product.occasions
    .map((occasion) => {
      const startsAt = withStockholmOffset(occasion.date, occasion.start);
      const endDate =
        occasion.end && clockMinutes(occasion.end) < clockMinutes(occasion.start)
          ? nextDate(occasion.date)
          : occasion.date;
      const endsAt = occasion.end ? withStockholmOffset(endDate, occasion.end) : undefined;
      return {
        startsAt,
        ...(endsAt ? { endsAt } : {}),
        day: occasion.date,
        ...(occasion.venue ? { venue: occasion.venue } : {}),
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function descriptionOf(product: HalsinglandProduct): string | undefined {
  const body = product.description?.trim();
  const intro = product.intro?.trim();
  if (intro && body && !body.toLowerCase().includes(intro.toLowerCase()))
    return `${intro}\n\n${body}`;
  return body || intro;
}

function sharedVenue(occasions: ResolvedOccasion[]): string | undefined {
  const names = [...new Set(occasions.map((occasion) => occasion.venue).filter(Boolean))];
  return names.length === 1 ? names[0] : undefined;
}

function metaOf(product: HalsinglandProduct): EventMeta | undefined {
  const meta: EventMeta = {};
  if (product.ageLimit !== undefined) meta.ageLimit = product.ageLimit;
  if (product.freeEntry) meta.freeEntry = true;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function mapProduct(
  product: HalsinglandProduct,
  collapse: OccasionCollapseOptions,
): IncomingEvent[] {
  const occasions = resolveOccasions(product);
  if (occasions.length === 0) return [];
  const description = descriptionOf(product);
  const priceAmount =
    priceAmountFromText(product.priceText?.replace(/\bSEK\b/gi, 'kr')) ??
    (product.freeEntry ? 0 : undefined);
  const venue = sharedVenue(occasions);
  const digital = venue?.toLocaleLowerCase('sv') === 'digitalt';
  const meta = metaOf(product);
  const onlineUrl = digital ? product.links.find((link) => link.url)?.url : undefined;
  const base = {
    title: product.title,
    ...(description ? { description } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: 'SEK' as const } : {}),
    ...(meta ? { meta } : {}),
    mode: digital ? ('digital' as const) : ('physical' as const),
    timezone: 'Europe/Stockholm' as const,
    ...(venue && !digital ? { venueName: venue } : {}),
    ...(product.town && !digital ? { address: product.town } : {}),
    ...(product.location && !digital ? { location: product.location } : {}),
    ...(onlineUrl ? { onlineUrl } : {}),
    sourceUrl: product.sourceUrl,
    ...(product.links.length > 0 ? { links: product.links } : {}),
    organizerKeys: product.organizerKeys,
    ...(product.organizerName ? { organizerName: product.organizerName } : {}),
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    ...(product.imageUrls ? { imageUrls: product.imageUrls } : {}),
    categoryHints: [],
    tags: [],
  };
  if (shouldCollapseOccasions(occasions, collapse)) {
    const first = occasions[0]!;
    const last = occasions.at(-1)!;
    return [
      {
        ...base,
        externalId: `${product.id}:span`,
        startsAt: first.startsAt,
        ...(last.endsAt ? { endsAt: last.endsAt } : {}),
        meta: withCollapsedSpan(
          meta,
          occasions.map((occasion) => ({
            startsAt: occasion.startsAt,
            ...(occasion.endsAt ? { endsAt: occasion.endsAt } : {}),
            ...(occasion.venue ? { venueName: occasion.venue } : {}),
          })),
        ),
      },
    ];
  }
  const grouped = withOccasionGroup(meta, product.id, occasions.length);
  return occasions.map((occasion) => ({
    ...base,
    externalId: `${product.id}:${occasion.startsAt.slice(0, 19)}:${occasion.endsAt?.slice(0, 19) ?? ''}`,
    startsAt: occasion.startsAt,
    ...(occasion.endsAt ? { endsAt: occasion.endsAt } : {}),
    ...(occasion.venue && !digital ? { venueName: occasion.venue } : {}),
    ...(grouped ? { meta: grouped } : {}),
  }));
}

function calendarRequest(): RequestInit {
  return {
    redirect: 'manual',
    headers: { 'user-agent': CALENDAR_USER_AGENT, [HTTP1_HEADER]: '1' },
  };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

async function fetchJson(
  ctx: SourceRunContext,
  url: URL,
  origin: URL,
): Promise<unknown | undefined> {
  const response = await ctx.fetch(url, calendarRequest());
  if (!response.ok || !sameHost(origin, responseUrl(response, url))) return undefined;
  try {
    return await readJson(response);
  } catch {
    return undefined;
  }
}

async function fetchList(ctx: SourceRunContext, origin: URL): Promise<ListItem[]> {
  const language = languageFromConfig(ctx.config);
  const filter = filterFromConfig(ctx.config);
  const sorting = sortingFromConfig(ctx.config);
  const pageSize = pageSizeFromConfig(ctx.config);
  const delayMs = delayMsFromConfig(ctx.config);
  const hits: ListItem[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let page = 1; page <= MAX_LIST_PAGES && hits.length < total; page += 1) {
    const url = new URL(`/${language}/se-och-gora/products`, origin);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('filter', filter);
    url.searchParams.set('sorting', sorting);
    const response = await ctx.fetch(url, calendarRequest());
    if (!response.ok) throw new Error(`destination-halsingland list failed (${response.status})`);
    if (!sameHost(origin, responseUrl(response, url))) {
      throw new Error('destination-halsingland list redirected off the calendar host');
    }
    const body = await readJson(response);
    if (!body || typeof body !== 'object') {
      throw new Error('destination-halsingland list was not JSON');
    }
    const record = body as { totalResults?: unknown; items?: unknown };
    if (typeof record.totalResults === 'number') total = record.totalResults;
    const items = Array.isArray(record.items) ? record.items : [];
    if (items.length === 0) break;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as ListItem;
      // if (row.id != 'todo-2900492') continue;
      // console.log('row', row, page);
      const id = productIdOf(row.id);
      if (!id || hits.some((existing) => productIdOf(existing.id) === id)) continue;
      hits.push(row);
      if (ctx.limit != null && hits.length >= ctx.limit) break;
    }
    if (ctx.limit != null && hits.length >= ctx.limit) {
      hits.length = ctx.limit;
      break;
    }
    if (items.length < pageSize) break;
    if (page < MAX_LIST_PAGES && hits.length < total) await sleep(delayMs);
  }
  if (Number.isFinite(total) && total > 0 && hits.length === 0) {
    throw new Error('destination-halsingland list had events but none could be parsed');
  }
  return hits;
}

async function* eachProduct(ctx: SourceRunContext): AsyncGenerator<HalsinglandRaw> {
  const origin = originFromConfig(ctx.config);
  const language = languageFromConfig(ctx.config);
  const delayMs = delayMsFromConfig(ctx.config);
  const hits = await fetchList(ctx, origin);
  let yielded = 0;
  for (const hit of hits) {
    if (ctx.limit != null && yielded >= ctx.limit) break;
    const id = productIdOf(hit.id);
    if (!id) continue;
    await sleep(delayMs);
    const contentUrl = new URL(`/${language}/product/productcontent`, origin);
    contentUrl.searchParams.set('cbisProductId', id);
    const bookingUrl = new URL(`/${language}/se-gora/todobookingcontrolcontext`, origin);
    bookingUrl.searchParams.set('cbisProductId', id);
    const [content, booking] = await Promise.all([
      fetchJson(ctx, contentUrl, origin),
      fetchJson(ctx, bookingUrl, origin),
    ]);
    const product = normalizeProduct(
      hit,
      content && typeof content === 'object' ? (content as ContentBody) : undefined,
      booking && typeof booking === 'object' ? (booking as BookingBody) : undefined,
      origin,
    );
    if (!product) {
      ctx.log('destination-halsingland skipped event with no occasions', { id });
      continue;
    }
    yielded += 1;
    yield { now: new Date().toISOString(), origin: origin.origin, products: [product] };
  }
  if (hits.length > 0 && yielded === 0) {
    throw new Error('destination-halsingland event pages had no occasions');
  }
}

export const destinationHalsingland = defineAdapter<HalsinglandRaw>({
  slug: 'destination-halsingland',
  kind: 'api',
  each: eachProduct,
  async fetchRaw(ctx) {
    const products: HalsinglandProduct[] = [];
    let origin = '';
    let now = new Date().toISOString();
    for await (const raw of eachProduct(ctx)) {
      origin = raw.origin;
      now = raw.now;
      products.push(...raw.products);
    }
    return { now, origin, products };
  },
  map(raw, ctx: SourceRunContext) {
    const collapse = occasionCollapseFromConfig(ctx?.config);
    return raw.products.flatMap((product) => mapProduct(product, collapse));
  },
});

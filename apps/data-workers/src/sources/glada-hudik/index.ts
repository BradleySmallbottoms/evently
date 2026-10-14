import { parseLinksFromText, priceAmountFromText } from '@local-events/domain';
import { defineAdapter, type IncomingEvent } from '@local-events/ingest';
import { load } from 'cheerio';
import {
  existingEventTags,
  keptTagsForProduct,
  matchEventTag,
  tagCatalog,
  type TagChoice,
} from './match-tag';

/**
 * Glada Hudik (Hudiksvall) via the public Citybreak calendar.
 * No API key. The list is GET /sv/api/cbis-product-list?nodeId=&page= only.
 * robots.txt disallows filtered queries (order, occasion, filter, search, categories, geo, arena).
 * A dense run of daily opening hours longer than 21 days becomes one event.
 */

const DEFAULT_ORIGIN = 'https://www.gladahudik.se';
const DEFAULT_NODE_ID = 841;
const DEFAULT_LANGUAGE = 'sv';
const MAX_LIST_PAGES = 20;
const LONG_SPAN_DAYS = 21;
const DENSE_SHARE = 0.6;
/** A series whose last day is only a couple of days ago stays in this year. */
const PAST_GRACE_DAYS = 2;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export interface GladaOccasion {
  day: number;
  month: number;
  /** Set when the page prints a year. Otherwise the mapper infers it. */
  year?: number;
  start: string;
  end?: string;
  venue?: string;
}

export interface GladaLink {
  type: 'tickets' | 'registration' | 'info';
  url: string;
  label?: string;
}

export interface GladaProduct {
  id: string;
  title: string;
  path: string;
  intro?: string;
  description?: string;
  imageUrl?: string;
  priceText?: string;
  organizerName?: string;
  organizerEmail?: string;
  address?: string;
  links: GladaLink[];
  occasions: GladaOccasion[];
  location?: { lat: number; lng: number };
  tag?: TagChoice;
  /** Tags already stored for this product's events. Set means the model is not asked again. */
  keptTags?: { externalId: string; tags: TagChoice[] }[];
}

export interface GladaRaw {
  now: string;
  origin: string;
  products: GladaProduct[];
}

interface ListHit {
  id: string;
  path: string;
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
    throw new Error('glada-hudik config.origin is not a URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'www.gladahudik.se' && host !== 'gladahudik.se')) {
    throw new Error('glada-hudik config.origin must be https://www.gladahudik.se');
  }
  return new URL(`https://${host}`);
}

function nodeIdFromConfig(config: Record<string, unknown>): number {
  const raw = config.nodeId ?? DEFAULT_NODE_ID;
  const id = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error('glada-hudik config.nodeId must be a positive integer');
  return id;
}

function languageFromConfig(config: Record<string, unknown>): string {
  const raw = typeof config.language === 'string' ? config.language.trim() : DEFAULT_LANGUAGE;
  if (!/^[a-z]{2}$/.test(raw))
    throw new Error('glada-hudik config.language must be a two-letter code');
  return raw;
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

function textOf(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
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

/** List cards are HTML fragments. The product id and path are enough to open the event page. */
export function parseListItem(html: string): ListHit | null {
  const $ = load(html);
  const link = $('a[data-productid]').first();
  const id = textOf(link.attr('data-productid'));
  const href = textOf(link.attr('href'));
  if (!id || !href.startsWith('/') || href.startsWith('//')) return null;
  return { id, path: href };
}

function parseOccasionRow(spans: string[]): GladaOccasion | null {
  const date = /(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/.exec(spans[0] ?? '');
  const month = date ? MONTHS[date[2]!.toLowerCase()] : undefined;
  const day = date ? Number(date[1]) : NaN;
  if (!date || !month || day < 1 || day > 31) return null;
  const time = /(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/.exec(spans[1] ?? '');
  if (!time) return null;
  const year = date[3] ? Number(date[3]) : undefined;
  const venue = textOf(spans[2]);
  return {
    day,
    month,
    ...(year ? { year } : {}),
    start: padTime(time[1]!),
    ...(time[2] ? { end: padTime(time[2]) } : {}),
    ...(venue ? { venue } : {}),
  };
}

function padTime(value: string): string {
  const [hour, minute] = value.split(':');
  return `${hour!.padStart(2, '0')}:${minute}`;
}

function parseContact(texts: string[]): {
  organizerName?: string;
  organizerEmail?: string;
  address?: string;
} {
  const email = texts.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))?.toLowerCase();
  const postalIndex = texts.findIndex((item) => /^\d{3}\s?\d{2}$/.test(item));
  const postal = postalIndex >= 0 ? texts[postalIndex] : undefined;
  const city = postalIndex >= 0 ? texts[postalIndex + 1] : undefined;
  const street = postalIndex > 0 ? texts[postalIndex - 1] : undefined;
  const used = new Set(
    [email, postal, city, street].filter((item): item is string => Boolean(item)),
  );
  const organizerName = texts.find(
    (item) => !used.has(item) && !item.includes('@') && !/^[+\d][\d\s-]{6,}$/.test(item),
  );
  const locality = [postal, city].filter(Boolean).join(' ');
  const address = [street, locality].filter(Boolean).join(', ') || undefined;
  return {
    ...(organizerName ? { organizerName } : {}),
    ...(email ? { organizerEmail: email } : {}),
    ...(address ? { address } : {}),
  };
}

/** Event page: title, occasions, price, links, contact, hero image. */
export function parseEventPage(html: string, id: string, path: string): GladaProduct | null {
  const $ = load(html);
  const title = textOf($('h1').first().text());
  if (!title) return null;
  const intro = textOf($('.cbis-item-intro').first().text());
  const description = textOf($('.read-more-inner').first().text());
  const imageUrl = httpsUrl($('meta[property="og:image"]').attr('content'));
  const priceText = textOf($('.fa-coins').parent().text());
  const occasions = $('.cbis-product-occasions--row')
    .toArray()
    .map((row) =>
      parseOccasionRow(
        $(row)
          .children('span')
          .toArray()
          .map((span) => textOf($(span).text())),
      ),
    )
    .filter((occasion): occasion is GladaOccasion => occasion !== null);
  const links = collectLinks($);
  const location = parseMap($);
  const contact = parseContact(
    $('.cbis-item-contact li')
      .toArray()
      .map((item) => textOf($(item).text()))
      .filter((item) => item.length > 0 && !/^webbplats$/i.test(item)),
  );
  return {
    id,
    title,
    path,
    ...(intro ? { intro } : {}),
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(priceText ? { priceText } : {}),
    ...contact,
    links,
    occasions,
    ...(location ? { location } : {}),
  };
}

/** Information, contact, and the description. Footer links on the destination site stay out. */
function collectLinks($: ReturnType<typeof load>): GladaLink[] {
  const html = ['.cbis-item-attributes', '.cbis-item-contact', '.read-more-inner']
    .map((selector) => $(selector).html() ?? '')
    .join('\n');
  return parseLinksFromText(html).map((link) => ({
    type: link.type,
    url: link.url,
    ...(link.label ? { label: link.label } : {}),
  }));
}

function parseMap($: ReturnType<typeof load>): { lat: number; lng: number } | undefined {
  const node = $('.sidebar-map').first();
  const lat = Number(node.attr('data-lat'));
  const lng = Number(node.attr('data-lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function stockholmYmd(now: Date): { y: number; m: number; d: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = formatted.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Years so a Oct→May listing crosses into the next year, and a past one-off rolls forward. */
export function assignOccasionYears(occasions: GladaOccasion[], now: Date): number[] {
  const today = stockholmYmd(now);
  let year = today.y;
  let previousKey = -1;
  const years: number[] = [];
  for (const occasion of occasions) {
    const key = occasion.month * 40 + occasion.day;
    let next = occasion.year ?? year;
    if (occasion.year == null && previousKey >= 0 && key < previousKey) next = year + 1;
    year = next;
    years.push(next);
    previousKey = key;
  }
  const last = occasions.at(-1);
  const lastYear = years.at(-1);
  if (!last || lastYear == null || occasions.some((occasion) => occasion.year != null))
    return years;
  const daysPast = dayNumber(today.y, today.m, today.d) - dayNumber(lastYear, last.month, last.day);
  if (daysPast > PAST_GRACE_DAYS) return years.map((value) => value + 1);
  return years;
}

function stockholmOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  let day = pick('day');
  let hour = pick('hour');
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    day,
    hour,
    pick('minute'),
    pick('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function withStockholmOffset(year: number, month: number, day: number, time: string): string {
  const [hour, minute] = time.split(':');
  const wallUtc = Date.UTC(year, month - 1, day, Number(hour), Number(minute), 0);
  let offset = stockholmOffsetMinutes(new Date(wallUtc));
  offset = stockholmOffsetMinutes(new Date(wallUtc - offset * 60_000));
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetHour = String(Math.floor(abs / 60)).padStart(2, '0');
  const offsetMinute = String(abs % 60).padStart(2, '0');
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}T${hour!.padStart(2, '0')}:${minute}:00${sign}${offsetHour}:${offsetMinute}`;
}

function resolveOccasions(product: GladaProduct, now: Date): ResolvedOccasion[] {
  const years = assignOccasionYears(product.occasions, now);
  return product.occasions.map((occasion, index) => {
    const year = years[index] ?? now.getUTCFullYear();
    const startsAt = withStockholmOffset(year, occasion.month, occasion.day, occasion.start);
    const endsAt = occasion.end
      ? withStockholmOffset(year, occasion.month, occasion.day, occasion.end)
      : undefined;
    return {
      startsAt,
      ...(endsAt ? { endsAt } : {}),
      day: startsAt.slice(0, 10),
      ...(occasion.venue ? { venue: occasion.venue } : {}),
    };
  });
}

function shouldCollapse(occasions: ResolvedOccasion[]): boolean {
  const first = occasions[0];
  const last = occasions.at(-1);
  if (!first || !last || occasions.length < 2) return false;
  const span = dayNumber(...ymd(last.day)) - dayNumber(...ymd(first.day));
  if (span <= LONG_SPAN_DAYS) return false;
  return occasions.length / (span + 1) >= DENSE_SHARE;
}

function ymd(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year!, month!, date!];
}

function descriptionOf(product: GladaProduct): string | undefined {
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

function mapProduct(product: GladaProduct, origin: string, now: Date): IncomingEvent[] {
  const sourceUrl = new URL(product.path, origin).href;
  const occasions = resolveOccasions(product, now).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  if (occasions.length === 0) return [];
  const description = descriptionOf(product);
  const priceAmount = priceAmountFromText(product.priceText?.replace(/\bSEK\b/gi, 'kr'));
  const venue = sharedVenue(occasions);
  const digital = venue?.toLowerCase() === 'digitalt';
  const links = product.links;
  const onlineUrl = digital ? links.find((link) => link.url)?.url : undefined;
  const base = {
    title: product.title,
    ...(description ? { description } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: 'SEK' as const } : {}),
    mode: digital ? ('digital' as const) : ('physical' as const),
    timezone: 'Europe/Stockholm' as const,
    ...(venue && !digital ? { venueName: venue } : {}),
    ...(product.address && venue && !digital ? { address: product.address } : {}),
    ...(product.location && !digital ? { location: product.location } : {}),
    ...(onlineUrl ? { onlineUrl } : {}),
    sourceUrl,
    ...(links.length > 0 ? { links } : {}),
    organizerKey: product.organizerEmail ?? product.organizerName?.toLowerCase() ?? 'glada-hudik',
    ...(product.organizerName ? { organizerName: product.organizerName } : {}),
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
  };
  const tagged = (externalId: string) => {
    const tags = tagsForMappedEvent(product, externalId);
    return {
      categoryHints: tags.map((tag) => tag.name),
      tags,
    };
  };
  if (shouldCollapse(occasions)) {
    const first = occasions[0]!;
    const last = occasions.at(-1)!;
    const externalId = `${product.id}:span`;
    return [
      {
        ...base,
        ...tagged(externalId),
        externalId,
        startsAt: first.startsAt,
        ...(last.endsAt ? { endsAt: last.endsAt } : {}),
      },
    ];
  }
  return occasions.map((occasion) => {
    const externalId = `${product.id}:${occasion.startsAt.slice(0, 19)}:${occasion.endsAt?.slice(0, 19) ?? ''}`;
    return {
      ...base,
      ...tagged(externalId),
      externalId,
      startsAt: occasion.startsAt,
      ...(occasion.endsAt ? { endsAt: occasion.endsAt } : {}),
      ...(occasion.venue && !digital ? { venueName: occasion.venue } : {}),
    };
  });
}

function tagsForMappedEvent(product: GladaProduct, externalId: string): TagChoice[] {
  const kept = product.keptTags?.find((row) => row.externalId === externalId)?.tags;
  if (kept && kept.length > 0) return kept;
  const inherited = product.keptTags?.find((row) => row.tags.length > 0)?.tags;
  if (inherited) return inherited;
  return product.tag ? [product.tag] : [];
}

async function assignTags(
  ctx: {
    config: Record<string, unknown>;
    log: (message: string, data?: Record<string, unknown>) => void;
  },
  products: GladaProduct[],
): Promise<void> {
  const catalog = tagCatalog(ctx.config);
  const stored = existingEventTags(ctx.config);
  if (catalog.length === 0 && stored.length === 0) return;
  for (const product of products) {
    const kept = keptTagsForProduct(product.id, stored);
    if (kept) {
      product.keptTags = kept;
      continue;
    }
    if (catalog.length === 0) continue;
    const venue = product.occasions.find((occasion) => occasion.venue)?.venue;
    const description = [product.intro, product.description].filter(Boolean).join('\n\n');
    const result = await matchEventTag(
      {
        title: product.title,
        ...(description ? { description } : {}),
        ...(venue ? { venue } : {}),
      },
      catalog,
      ctx.config,
      fetch,
    );
    if (!result.ok) {
      ctx.log('glada-hudik tag matcher unavailable');
      return;
    }
    if (result.tag) product.tag = result.tag;
  }
}

async function readJson(response: Response): Promise<{ totalCount?: number; items?: unknown[] }> {
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') throw new Error('glada-hudik list was not JSON');
  return body as { totalCount?: number; items?: unknown[] };
}

export const gladaHudik = defineAdapter<GladaRaw>({
  slug: 'glada-hudik',
  kind: 'scraper',
  async fetchRaw(ctx) {
    const origin = originFromConfig(ctx.config);
    const nodeId = nodeIdFromConfig(ctx.config);
    const language = languageFromConfig(ctx.config);
    const delayMs = delayMsFromConfig(ctx.config);
    const hits: ListHit[] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let page = 0; page < MAX_LIST_PAGES && hits.length < total; page += 1) {
      const url = new URL(`/${language}/api/cbis-product-list`, origin);
      url.searchParams.set('nodeId', String(nodeId));
      url.searchParams.set('page', String(page));
      const response = await ctx.fetch(url);
      if (!response.ok) throw new Error(`glada-hudik list failed (${response.status})`);
      if (!sameHost(origin, responseUrl(response, url))) {
        throw new Error('glada-hudik list redirected off the calendar host');
      }
      const body = await readJson(response);
      const items = Array.isArray(body.items) ? body.items : [];
      if (typeof body.totalCount === 'number') total = body.totalCount;
      if (items.length === 0) break;
      for (const item of items) {
        if (typeof item !== 'string') continue;
        const hit = parseListItem(item);
        if (hit && !hits.some((existing) => existing.id === hit.id)) hits.push(hit);
      }
      if (page + 1 < MAX_LIST_PAGES && hits.length < total) await sleep(delayMs);
    }
    if (total > 0 && hits.length === 0) {
      throw new Error('glada-hudik list had events but none could be parsed');
    }
    const products: GladaProduct[] = [];
    for (const hit of hits) {
      // if (hit.id !== 'cbis:2882123') { // && hit.id !== 'cbis:2866536') {
      //   continue;
      // }
      console.log('hit', hit);
      const pageUrl = new URL(hit.path, origin);
      if (!sameHost(origin, pageUrl)) continue;
      await sleep(delayMs);
      const response = await ctx.fetch(pageUrl);
      if (!response.ok || !sameHost(origin, responseUrl(response, pageUrl))) {
        ctx.log('glada-hudik skipped event page', { id: hit.id, status: response.status });
        continue;
      }
      const product = parseEventPage(await response.text(), hit.id, pageUrl.pathname);
      if (product && product.occasions.length > 0) products.push(product);
      else ctx.log('glada-hudik skipped event with no occasions', { id: hit.id });
    }
    if (hits.length > 0 && products.length === 0) {
      throw new Error('glada-hudik event pages had no occasions');
    }
    await assignTags(ctx, products);
    return { now: new Date().toISOString(), origin: origin.origin, products };
  },
  tags(raw) {
    const byId = new Map<string, string>();
    for (const product of raw.products) {
      const choices = [
        ...(product.tag ? [product.tag] : []),
        ...(product.keptTags?.flatMap((row) => row.tags) ?? []),
      ];
      for (const tag of choices) byId.set(tag.externalId, tag.name);
    }
    return [...byId.entries()].map(([externalId, name]) => ({ externalId, name }));
  },
  map(raw) {
    const now = new Date(raw.now);
    const clock = Number.isNaN(now.getTime()) ? new Date() : now;
    const origin = raw.origin || DEFAULT_ORIGIN;
    return raw.products.flatMap((product) => mapProduct(product, origin, clock));
  },
});

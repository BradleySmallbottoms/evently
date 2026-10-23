import type { EventMeta } from '@local-events/contracts';
import {
  eventAddress,
  mergeImportedLinks,
  organizerKeys,
  priceAmountFromText,
  sourceDateTime,
} from '@local-events/domain';
import {
  defineAdapter,
  occasionCollapseFromConfig,
  type IncomingEvent,
  type OccasionCollapseOptions,
  type SourceRunContext,
} from '@local-events/ingest';
import { crawlLinkImages } from './page-images';

/**
 * Visit Söderhamn via the Citybreak CBIS API.
 * Same selection as the previous lambda: products in category 30172 (Evenemang),
 * one incoming event per product with one or more occasion rows.
 * The API key is VISIT_SODERHAMN_API_KEY, never config.
 */

const DEFAULT_BASE_URL = 'https://cbis-rest-api.citybreak.com/v1/api';
/** Evenemang, under Göra. Lodging and the rest of Göra stay out. */
const DEFAULT_EVENT_CATEGORY_ID = 30172;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LANGUAGE = 'sv-se';
const API_KEY_ENV = 'VISIT_SODERHAMN_API_KEY';
const MAX_CATEGORY_PAGES = 30;
const MAX_PRODUCT_PAGES = 100;

const NAME = 99;
const INGRESS = 101;
const DESCRIPTION = 102;
const WEBSITE = 110;
const STREET = 117;
const POSTAL_CODE = 120;
const CITY = 121;
const CONTACT = 160;
const EMAIL = 161;
const EVENT_LINK = 125;
const BOOKING_LINK = 126;
const PRICE_INFO = 106;
const AGE_LIMIT = 127;
const CURRENCY = 402;
const PRICE_FROM = 1012;
const FREE_ENTRY = 100021;
const MAX_PRICE_MAJOR = 100_000;

const AMENITIES = [
  [100093, 'accessibleParking'],
  [100095, 'accessibleToilet'],
  [100094, 'hearingLoop'],
  [101014, 'visuallyImpairedAccess'],
  [100036, 'wheelchairAccessible'],
  [100593, 'wheelchairAccessible'],
  [100037, 'petsAllowed'],
  [100085, 'childFriendly'],
  [100631, 'allergyAdapted'],
  [100188, 'smokeFree'],
  [100060, 'wc'],
] as const;

export interface VisitCategory {
  Id: number;
  Name: string;
  Path?: number[];
}

export interface VisitProduct {
  Id: string;
  Name?: string;
  Categories?: { Path?: { Id?: number; Section?: string }[] }[];
  Information?: { Id?: number; Value?: unknown }[];
  Position?: { Latitude?: number; Longitude?: number } | null;
  Media?: { Type?: string; Url?: string }[];
  Occasions?: {
    Start?: string;
    End?: string;
    Arena?: {
      Name?: string;
      Position?: { Latitude?: number; Longitude?: number } | null;
    };
  }[];
}

export interface VisitRaw {
  categories: VisitCategory[];
  products: VisitProduct[];
  /**
   * Images found by following each product's links. Og images come first.
   * `null` means every page fetch failed. Missing means the product had no links.
   */
  crawledImages?: Record<string, string[] | null>;
}

interface VisitConfig {
  baseUrl: string;
  eventCategoryId: number;
  pageSize: number;
  language: string;
}

interface Paged<T> {
  ContinueToken?: string;
  TotalResults?: number;
  Result?: T[];
}

function visitConfig(config: Record<string, unknown>): VisitConfig {
  const requested =
    typeof config.baseUrl === 'string' && config.baseUrl.trim()
      ? config.baseUrl.trim()
      : DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(requested);
  } catch {
    throw new Error('Visit baseUrl is not a URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'cbis-rest-api.citybreak.com' ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Visit baseUrl must be https://cbis-rest-api.citybreak.com');
  }
  const baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  const eventCategoryId =
    typeof config.eventCategoryId === 'number' && Number.isInteger(config.eventCategoryId)
      ? config.eventCategoryId
      : DEFAULT_EVENT_CATEGORY_ID;
  const pageSize =
    typeof config.pageSize === 'number' && config.pageSize > 0
      ? Math.floor(config.pageSize)
      : DEFAULT_PAGE_SIZE;
  const language =
    typeof config.language === 'string' && config.language.trim()
      ? config.language.trim()
      : DEFAULT_LANGUAGE;
  if (language.length > 35 || /[\r\n]/.test(language)) throw new Error('Visit language is invalid');
  return { baseUrl, eventCategoryId, pageSize, language };
}

function apiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) throw new Error(`${API_KEY_ENV} is not set`);
  return key;
}

function headers(key: string, language: string, jsonBody: boolean): Record<string, string> {
  return {
    ApiKey: key,
    Accept: 'application/json',
    'Accept-Language': language,
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

// @types/node leaves the global Response empty when globalThis has `onmessage`
// and no DOM Response is in scope. fetch() still has these fields at runtime.
type JsonResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

async function readJson(res: Response): Promise<unknown> {
  const http = res as JsonResponse;
  if (!http.ok) throw new Error(`Visit API request failed (${http.status})`);
  return http.json();
}

function asPaged<T>(body: unknown): Paged<T> {
  if (!body || typeof body !== 'object') throw new Error('Visit API returned a non-object page');
  return body as Paged<T>;
}

async function fetchCategories(
  ctx: SourceRunContext,
  cfg: VisitConfig,
  key: string,
): Promise<VisitCategory[]> {
  const pageSize = Math.min(49, cfg.pageSize);
  const first = asPaged<VisitCategory>(
    await readJson(
      await ctx.fetch(`${cfg.baseUrl}/raw/category/getpaged/${pageSize}`, {
        headers: headers(key, cfg.language, false),
      }),
    ),
  );
  const categories = [...(first.Result ?? [])];
  let token = first.ContinueToken;
  const seen = new Set<string>();
  let pages = 1;
  while (token && (first.Result?.length ?? 0) > 0) {
    if (categories.length >= (first.TotalResults ?? Infinity) && pages > 1) break;
    if (seen.has(token)) throw new Error('Visit category pagination repeated a continue token');
    seen.add(token);
    if (pages >= MAX_CATEGORY_PAGES)
      throw new Error('Visit category pagination exceeded the page cap');
    const page = asPaged<VisitCategory>(
      await readJson(
        await ctx.fetch(`${cfg.baseUrl}/raw/category/getnext/${encodeURIComponent(token)}`, {
          headers: headers(key, cfg.language, false),
        }),
      ),
    );
    pages += 1;
    const batch = page.Result ?? [];
    if (batch.length === 0) break;
    categories.push(...batch);
    token = page.ContinueToken;
  }
  ctx.log('categories fetched', { count: categories.length });
  return categories;
}

async function fetchProducts(
  ctx: SourceRunContext,
  cfg: VisitConfig,
  key: string,
): Promise<VisitProduct[]> {
  const products: VisitProduct[] = [];
  let total = Infinity;
  for (let page = 0; page < MAX_PRODUCT_PAGES && products.length < total; page += 1) {
    const body = asPaged<VisitProduct>(
      await readJson(
        await ctx.fetch(`${cfg.baseUrl}/product`, {
          method: 'POST',
          headers: headers(key, cfg.language, true),
          body: JSON.stringify({
            Categories: [cfg.eventCategoryId],
            Page: page,
            PageSize: cfg.pageSize,
          }),
        }),
      ),
    );
    const batch = body.Result ?? [];
    if (typeof body.TotalResults === 'number') total = body.TotalResults;
    if (batch.length === 0) break;
    products.push(...batch);
    if (ctx.limit != null && products.length >= ctx.limit) {
      products.length = ctx.limit;
      break;
    }
    if (typeof body.TotalResults !== 'number') break;
  }
  const stoppedEarly = ctx.limit != null && products.length >= ctx.limit;
  if (!stoppedEarly && Number.isFinite(total) && products.length < total) {
    throw new Error(`Visit products incomplete (${products.length} of ${total})`);
  }
  ctx.log('products fetched', { count: products.length, categoryId: cfg.eventCategoryId });
  return products;
}

function textValues(product: VisitProduct, id: number): string[] {
  const values: string[] = [];
  for (const item of product.Information ?? []) {
    if (item.Id !== id || typeof item.Value !== 'string') continue;
    const trimmed = item.Value.trim();
    if (trimmed) values.push(trimmed);
  }
  return values;
}

function textField(product: VisitProduct, id: number): string | undefined {
  return textValues(product, id)[0];
}

function infoValue(product: VisitProduct, id: number): unknown {
  return product.Information?.find((item) => item.Id === id)?.Value;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (/^true$/i.test(value.trim())) return true;
  if (/^false$/i.test(value.trim())) return false;
  return undefined;
}

function minorFromMajor(major: number | undefined): number | undefined {
  if (major === undefined || major < 0 || major > MAX_PRICE_MAJOR) return undefined;
  const minor = Math.round(major * 100);
  if (!Number.isSafeInteger(minor) || minor > 10_000_000) return undefined;
  return minor;
}

function currencyCode(product: VisitProduct): string {
  const code = textField(product, CURRENCY);
  return code && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : 'SEK';
}

/** Price From, then Prisinformation, then the description. Fri entré is free when no amount is stated. */
function priceOf(
  product: VisitProduct,
  description: string | undefined,
): { priceAmount?: number; currency?: string } {
  const infoText = textField(product, PRICE_INFO);
  const fromInfo =
    infoText && /^[\d\s.,]+$/.test(infoText)
      ? minorFromMajor(numberValue(infoText))
      : priceAmountFromText(infoText);
  const structured =
    minorFromMajor(numberValue(infoValue(product, PRICE_FROM))) ??
    fromInfo ??
    priceAmountFromText(description);
  const priceAmount =
    structured ?? (boolValue(infoValue(product, FREE_ENTRY)) === true ? 0 : undefined);
  if (priceAmount === undefined) return {};
  return { priceAmount, currency: currencyCode(product) };
}

type AmenityKey = {
  [Key in keyof EventMeta]: EventMeta[Key] extends boolean | undefined ? Key : never;
}[keyof EventMeta];

function addressed(
  meta: EventMeta | undefined,
  product: VisitProduct,
  location?: { lat: number; lng: number },
): EventMeta | undefined {
  const address = eventAddress({
    address: textField(product, STREET),
    zipCode: textField(product, POSTAL_CODE),
    city: textField(product, CITY),
    location,
  });
  if (!address) return meta;
  return { ...meta, address };
}

function metaOf(product: VisitProduct): EventMeta | undefined {
  const meta: EventMeta = {};
  const age = numberValue(infoValue(product, AGE_LIMIT));
  if (age !== undefined && Number.isInteger(age) && age >= 0 && age <= 120) meta.ageLimit = age;
  if (boolValue(infoValue(product, FREE_ENTRY)) === true) meta.freeEntry = true;
  for (const [id, key] of AMENITIES) {
    if (boolValue(infoValue(product, id)) === true) meta[key satisfies AmenityKey] = true;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function pointOf(
  position?: { Latitude?: number; Longitude?: number } | null,
): { lat: number; lng: number } | undefined {
  const lat = position?.Latitude;
  const lng = position?.Longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

function asUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return undefined;
  }
}

function imageUrl(product: VisitProduct): string | undefined {
  const main =
    product.Media?.find((item) => item.Type === 'MainImage' && item.Url) ??
    product.Media?.find((item) => item.Url);
  if (!main?.Url) return undefined;
  const absolute = main.Url.startsWith('//') ? `https:${main.Url}` : main.Url;
  return asUrl(absolute);
}

function addressOf(product: VisitProduct): string | undefined {
  const street = textField(product, STREET);
  const postal = textField(product, POSTAL_CODE);
  const city = textField(product, CITY);
  const locality = [postal, city].filter(Boolean).join(' ');
  const line = [street, locality].filter(Boolean).join(', ');
  return line ? `${line}, Sweden` : undefined;
}

function productTags(
  product: VisitProduct,
  eventCategoryId: number,
): { externalId: string; name: string }[] {
  const tags: { externalId: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const category of product.Categories ?? []) {
    const path = category.Path ?? [];
    const eventIndex = path.findIndex((node) => node.Id === eventCategoryId);
    if (eventIndex < 0) continue;
    for (const node of path.slice(eventIndex + 1)) {
      const name = node.Section?.trim();
      if (!name) continue;
      const externalId = `visit-soderhamn:${node.Id}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      tags.push({ externalId, name });
    }
  }
  return tags;
}

/** Categories under Evenemang, from the tree and from product paths. */
export function visitTags(
  raw: VisitRaw,
  eventCategoryId: number,
): { externalId: string; name: string }[] {
  const byExternal = new Map<string, string>();
  for (const category of raw.categories) {
    if (category.Id === eventCategoryId) continue;
    if (!(category.Path ?? []).includes(eventCategoryId)) continue;
    const name = category.Name?.trim();
    if (name) byExternal.set(`visit-soderhamn:${category.Id}`, name);
  }
  for (const product of raw.products) {
    for (const tag of productTags(product, eventCategoryId)) {
      byExternal.set(tag.externalId, tag.name);
    }
  }
  return [...byExternal.entries()]
    .map(([externalId, name]) => ({ externalId, name }))
    .sort((a, b) => a.externalId.localeCompare(b.externalId, 'en'));
}

function linksForProduct(product: VisitProduct): string[] {
  const description = textField(product, DESCRIPTION) ?? textField(product, INGRESS);
  return (mergeImportedLinks(productLinks(product), description) ?? []).map((link) => link.url);
}

function canMapProduct(product: VisitProduct): boolean {
  const title = textField(product, NAME) ?? product.Name?.trim();
  const sourceUrl = asUrl(textField(product, EVENT_LINK)) ?? asUrl(textField(product, WEBSITE));
  return Boolean(title && sourceUrl);
}

/**
 * Citybreak media stays the hero. A crawled og:image fills in when that media is
 * missing, then any other page image. `imageUrls` is omitted when the crawl did not run.
 */
export function picturesFor(
  apiImage: string | undefined,
  crawled: string[] | null | undefined,
): { imageUrl?: string; imageUrls?: string[] } {
  if (crawled == null) return apiImage ? { imageUrl: apiImage } : {};
  const extras = crawled.filter((url) => url !== apiImage);
  const image = apiImage ?? extras[0];
  const imageUrls = apiImage ? extras : extras.slice(1);
  return {
    ...(image ? { imageUrl: image } : {}),
    imageUrls,
  };
}

function productLinks(product: VisitProduct): NonNullable<IncomingEvent['links']> {
  const links: NonNullable<IncomingEvent['links']> = [];
  const seen = new Set<string>();
  const push = (type: 'tickets' | 'info', url: string | undefined) => {
    if (!url || seen.has(url) || links.length >= 10) return;
    seen.add(url);
    links.push({ type, url });
  };
  for (const value of textValues(product, BOOKING_LINK)) push('tickets', asUrl(value));
  for (const value of textValues(product, EVENT_LINK)) push('info', asUrl(value));
  for (const value of textValues(product, WEBSITE)) push('info', asUrl(value));
  return links;
}

type VisitOccasion = {
  startRaw: string;
  endRaw?: string;
  startsAt: string;
  endsAt?: string;
  day: string;
  venue?: string;
  location?: { lat: number; lng: number };
};

function resolveVisitOccasions(product: VisitProduct): VisitOccasion[] {
  const occasions: VisitOccasion[] = [];
  for (const occasion of product.Occasions ?? []) {
    if (!occasion.Start) continue;
    const venue = occasion.Arena?.Name?.trim();
    const location = pointOf(occasion.Arena?.Position) ?? pointOf(product.Position);
    const endsAt = occasion.End ? sourceDateTime(occasion.End) : undefined;
    occasions.push({
      startRaw: occasion.Start,
      ...(occasion.End ? { endRaw: occasion.End } : {}),
      startsAt: sourceDateTime(occasion.Start),
      ...(endsAt ? { endsAt } : {}),
      day: occasion.Start.slice(0, 10),
      ...(venue ? { venue } : {}),
      ...(location ? { location } : {}),
    });
  }
  occasions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return occasions;
}

function sharedName(names: (string | undefined)[]): string | undefined {
  const unique = [...new Set(names.filter((name): name is string => Boolean(name)))];
  return unique.length === 1 ? unique[0] : undefined;
}

function sharedLocation(
  points: ({ lat: number; lng: number } | undefined)[],
): { lat: number; lng: number } | undefined {
  const present = points.filter((point): point is { lat: number; lng: number } => point != null);
  const first = present[0];
  if (!first) return undefined;
  if (present.every((point) => point.lat === first.lat && point.lng === first.lng)) return first;
  return undefined;
}

function mapProduct(
  product: VisitProduct,
  eventCategoryId: number,
  crawled: string[] | null | undefined,
  collapse: OccasionCollapseOptions,
): IncomingEvent[] {
  const title = textField(product, NAME) ?? product.Name?.trim();
  const sourceUrl = asUrl(textField(product, EVENT_LINK)) ?? asUrl(textField(product, WEBSITE));
  const links = productLinks(product);
  if (!title || !sourceUrl) return [];
  const occasions = resolveVisitOccasions(product);
  const email = textField(product, EMAIL);
  const contact = textField(product, CONTACT);
  const description = textField(product, DESCRIPTION) ?? textField(product, INGRESS);
  const priced = priceOf(product, description);
  const meta = metaOf(product);
  const address = addressOf(product);
  const pictures = picturesFor(imageUrl(product), crawled);
  const categoryNames = productTags(product, eventCategoryId).map((tag) => tag.name);
  const base = {
    title,
    ...(description ? { description } : {}),
    ...(priced.priceAmount !== undefined
      ? { priceAmount: priced.priceAmount, currency: priced.currency ?? 'SEK' }
      : {}),
    mode: 'physical' as const,
    timezone: 'Europe/Stockholm' as const,
    ...(address ? { address } : {}),
    sourceUrl,
    ...(links.length > 0 ? { links } : {}),
    organizerKeys: organizerKeys({
      emails: [email],
      infoUrls: links.filter((link) => link.type === 'info').map((link) => link.url),
      names: [contact],
      fallback: 'visit-soderhamn',
      skipHosts: ['visitsoderhamn.se'],
    }),
    ...(contact || email ? { organizerName: contact ?? email } : {}),
    categoryHints: categoryNames,
    tags: [] as IncomingEvent['tags'],
    ...pictures,
  };
  if (occasions.length === 0) {
    const location = pointOf(product.Position);
    const next = addressed(meta, product, location);
    return [
      {
        ...base,
        externalId: String(product.Id),
        ...(location ? { location } : {}),
        ...(next ? { meta: next } : {}),
      },
    ];
  }
  void collapse;
  const first = occasions[0]!;
  const last = occasions.at(-1)!;
  const venue = sharedName(occasions.map((occasion) => occasion.venue));
  const location =
    sharedLocation(occasions.map((occasion) => occasion.location)) ?? pointOf(product.Position);
  return [
    {
      ...base,
      externalId: String(product.Id),
      startsAt: first.startsAt,
      endsAt: last.endsAt ?? first.endsAt ?? first.startsAt,
      ...(venue ? { venueName: venue, arenaName: venue } : {}),
      ...(location ? { location } : {}),
      occasions: occasions.map((occasion) => {
        const point = occasion.location ?? location;
        return {
          startsAt: occasion.startsAt,
          endsAt: occasion.endsAt ?? occasion.startsAt,
          ...(occasion.venue ? { venueName: occasion.venue } : {}),
          ...(point ? { location: point } : {}),
          sourceKey: `${occasion.startRaw}:${occasion.endRaw ?? ''}`,
        };
      }),
      ...(addressed(meta, product, location) ? { meta: addressed(meta, product, location) } : {}),
    },
  ];
}

export const visitSoderhamn = defineAdapter<VisitRaw>({
  slug: 'visit-soderhamn',
  kind: 'api',
  async fetchRaw(ctx) {
    const cfg = visitConfig(ctx.config);
    const key = apiKey();
    const categories = await fetchCategories(ctx, cfg, key);
    if (!categories.some((category) => category.Id === cfg.eventCategoryId)) {
      throw new Error(`Visit category ${cfg.eventCategoryId} was not in the category tree`);
    }
    const products = await fetchProducts(ctx, cfg, key);
    const crawledImages = await crawlLinkImages(
      ctx,
      products
        .filter(canMapProduct)
        .map((product) => ({ id: product.Id, urls: linksForProduct(product) })),
    );
    return { categories, products, crawledImages };
  },
  map(raw, ctx) {
    const { eventCategoryId } = visitConfig(ctx.config);
    const collapse = occasionCollapseFromConfig(ctx.config);
    return raw.products.flatMap((product) =>
      mapProduct(product, eventCategoryId, raw.crawledImages?.[product.Id], collapse),
    );
  },
  tags(raw, ctx) {
    return visitTags(raw, visitConfig(ctx.config).eventCategoryId);
  },
});

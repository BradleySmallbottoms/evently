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
 * Tickster Event API v1.0. The key is TICKSTER_API_KEY, never config.
 * Upcoming events for each configured city, then that event's detail.
 * A production or collection is the parent of its showings, so it is skipped.
 * Each showing is one event. A UTC time is that instant. The import does not geocode.
 * A 429, or `X-RATELIMIT-REMAINING: 0`, waits one five-minute slot and retries.
 */

const API_ORIGIN = 'https://event.api.tickster.com';
const API_HOST = 'event.api.tickster.com';
const API_KEY_ENV = 'TICKSTER_API_KEY';
const DEFAULT_CITIES = ['Söderhamn', 'Bollnäs', 'Hudiksvall', 'Ljusdal'];
const DEFAULT_LANGUAGE = 'sv';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES = 30;
/** Tickster counts the hourly limit in five-minute slots. */
const RATE_LIMIT_SLOT_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 12;
const MAX_MAJOR = 100_000;
const ORGANIZER_FALLBACK = 'tickster';
const LANGUAGES = new Set(['sv', 'en', 'nb', 'da']);
const SKIP_HIERARCHY = new Set(['production', 'collection']);
const SKIP_STATE = new Set(['cancelled', 'notreleased', 'undefined', 'releasedfornonpublicsale']);
const TICKET_TYPES = new Set(['ticket', 'numberedticket', 'package']);
const EVENT_ID = /^[A-Za-z0-9_-]{4,80}$/;

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
  pageSize: number;
  delayMs: number;
  rateLimitWaitMs: number;
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

function pageSizeFromConfig(config: Record<string, unknown>): number {
  const raw = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new Error('tickster config.pageSize must be 1–100');
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
  const raw = config.rateLimitWaitMs ?? RATE_LIMIT_SLOT_MS;
  const wait = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(wait) || wait < 0 || wait > 60 * 60 * 1000) return RATE_LIMIT_SLOT_MS;
  return wait;
}

function settingsFromConfig(config: Record<string, unknown>): TicksterSettings {
  return {
    cities: citiesFromConfig(config),
    language: languageFromConfig(config),
    pageSize: pageSizeFromConfig(config),
    delayMs: delayMsFromConfig(config),
    rateLimitWaitMs: rateLimitWaitMsFromConfig(config),
  };
}

/**
 * Pause for a rate-limit slot when the last response had none left.
 * Otherwise keep the normal gap between requests.
 */
export function ticksterRequestPauseMs(input: {
  requests: number;
  remaining: number | undefined;
  delayMs: number;
  rateLimitWaitMs: number;
}): number {
  if (input.remaining === 0) return input.rateLimitWaitMs;
  if (input.requests > 0) return input.delayMs;
  return 0;
}

function apiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) throw new Error(`${API_KEY_ENV} is not set`);
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiUrl(language: string, path: string, query?: Record<string, string>): URL {
  const url = new URL(`/api/v1.0/${language}${path}`, API_ORIGIN);
  if (query) {
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  }
  return url;
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

function rateLimitRemaining(response: Response): number | undefined {
  const raw = response.headers.get('x-ratelimit-remaining')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function failedRequest(status: number): Error & { status?: number } {
  const error = new Error(`Tickster API request failed (${status})`) as Error & { status?: number };
  error.status = status;
  return error;
}

async function readJson(
  ctx: SourceRunContext,
  url: URL,
  key: string,
  waitMs: number,
): Promise<{ body: unknown; remaining: number | undefined }> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await ctx.fetch(url, {
      headers: { Accept: 'application/json', 'x-api-key': key },
      redirect: 'error',
    });
    if (!sameHost(responseUrl(response, url))) {
      throw new Error('tickster request redirected off event.api.tickster.com');
    }
    const remaining = rateLimitRemaining(response);
    if (response.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) throw failedRequest(429);
      ctx.log('tickster rate limit', { remaining: remaining ?? null, retry: attempt + 1 });
      await sleep(waitMs);
      continue;
    }
    if (!response.ok) throw failedRequest(response.status);
    return { body: await response.json(), remaining };
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
  const social = recordOf(body.socialMedia);
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

/** A venue city matches a configured city. An empty city stays, because the search already filtered. */
export function ticksterCityMatches(city: string | undefined, allowed: string[]): boolean {
  if (!city?.trim()) return true;
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

function childEventsOf(value: unknown): unknown[] {
  const body = recordOf(value);
  return Array.isArray(body?.childEvents) ? body.childEvents : [];
}

/** A showing keeps its own time and venue. Text, price, and image fall back to the parent. */
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
    products: child.products.length > 0 ? child.products : parent.products,
    webLinks: child.webLinks.length > 0 ? child.webLinks : parent.webLinks,
  };
}

function httpStatus(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<TicksterRaw> {
  const settings = settingsFromConfig(ctx.config);
  const key = apiKey();
  const seen = new Set<string>();
  const organizers = new Map<string, TicksterOrganizer | undefined>();
  let yielded = 0;
  let requests = 0;
  let remaining: number | undefined;

  const load = async (url: URL): Promise<unknown> => {
    const pause = ticksterRequestPauseMs({
      requests,
      remaining,
      delayMs: settings.delayMs,
      rateLimitWaitMs: settings.rateLimitWaitMs,
    });
    if (pause > 0) await sleep(pause);
    requests += 1;
    const result = await readJson(ctx, url, key, settings.rateLimitWaitMs);
    remaining = result.remaining;
    return result.body;
  };

  const organizerFor = async (id: string | undefined): Promise<TicksterOrganizer | undefined> => {
    if (!id || !EVENT_ID.test(id)) return undefined;
    if (organizers.has(id)) return organizers.get(id);
    let organizer: TicksterOrganizer | undefined;
    try {
      organizer = parseTicksterOrganizer(
        await load(apiUrl(settings.language, `/organizers/${id}`)),
      );
    } catch (error) {
      if (httpStatus(error) !== 404) throw error;
    }
    organizers.set(id, organizer);
    return organizer;
  };

  const emit = async (event: TicksterEvent): Promise<TicksterRaw | undefined> => {
    if (seen.has(event.id) || !ticksterShowing(event, settings.cities)) return undefined;
    seen.add(event.id);
    const organizer = await organizerFor(event.organizerId);
    yielded += 1;
    return { events: [{ event, ...(organizer ? { organizer } : {}) }] };
  };

  for (const city of settings.cities) {
    let skip = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (ctx.limit != null && yielded >= ctx.limit) return;
      const body = recordOf(
        await load(
          apiUrl(settings.language, '/events', {
            query: `city:${city}`,
            take: String(settings.pageSize),
            skip: String(skip),
          }),
        ),
      );
      const items = Array.isArray(body?.items) ? body.items : [];
      const total = numberOf(body?.totalItems);
      if (items.length === 0) break;
      for (const item of items) {
        if (ctx.limit != null && yielded >= ctx.limit) return;
        const summary = parseTicksterEvent(item);
        if (!summary || seen.has(summary.id)) continue;
        const hierarchy = summary.eventHierarchyType?.toLocaleLowerCase('sv');
        if (hierarchy && SKIP_HIERARCHY.has(hierarchy)) {
          seen.add(summary.id);
          let payload: unknown;
          try {
            payload = await load(apiUrl(settings.language, `/events/${summary.id}`));
          } catch (error) {
            if (httpStatus(error) === 404) {
              ctx.log('tickster skipped a missing event', { id: summary.id });
              continue;
            }
            throw error;
          }
          const parent = parseTicksterEvent(payload) ?? summary;
          for (const child of childEventsOf(payload)) {
            if (ctx.limit != null && yielded >= ctx.limit) return;
            const showing = parseTicksterEvent(child);
            if (!showing) continue;
            const raw = await emit(withParentCopy(showing, parent));
            if (raw) yield raw;
          }
          continue;
        }
        if (!ticksterShowing(summary, settings.cities)) continue;
        let payload: unknown;
        try {
          payload = await load(apiUrl(settings.language, `/events/${summary.id}`));
        } catch (error) {
          if (httpStatus(error) === 404) {
            ctx.log('tickster skipped a missing event', { id: summary.id });
            continue;
          }
          throw error;
        }
        const detail = parseTicksterEvent(payload) ?? summary;
        const detailHierarchy = detail.eventHierarchyType?.toLocaleLowerCase('sv');
        if (detailHierarchy && SKIP_HIERARCHY.has(detailHierarchy)) {
          seen.add(detail.id);
          for (const child of childEventsOf(payload)) {
            if (ctx.limit != null && yielded >= ctx.limit) return;
            const showing = parseTicksterEvent(child);
            if (!showing) continue;
            const raw = await emit(withParentCopy(showing, detail));
            if (raw) yield raw;
          }
          continue;
        }
        const raw = await emit(detail);
        if (raw) yield raw;
      }
      skip += items.length;
      if ((total != null && skip >= total) || items.length < settings.pageSize) break;
    }
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

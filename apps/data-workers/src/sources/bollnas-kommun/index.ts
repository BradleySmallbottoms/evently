import type { EventMeta } from '@local-events/contracts';
import {
  eventAddress,
  eventUrlKey,
  organizerKeys,
  parseLinksFromText,
  priceAmountFromText,
  sourceDateTime,
  stockholmWallTime,
  type ImportEventLink,
} from '@local-events/domain';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';

/**
 * Bollnäs kommun via the Soleil eventsCalendar JSON the calendar page already loads.
 * robots.txt allows that route and disallows jsessionid URLs. Each row is one showing.
 * A row with no date is still saved. The place is stored on meta.address. The import does not geocode.
 */

const DEFAULT_ORIGIN = 'https://bollnas.se';
const DEFAULT_RESOURCE_PATH = '/appresource/4.825d63f17dc1e8befb7a0c5/12.825d63f17dc1e8befb7a248';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGES = 30;
const ORGANIZER_FALLBACK = 'bollnas-kommun';

const TOWNS = [
  'Bollnäs',
  'Kilafors',
  'Arbrå',
  'Rengsjö',
  'Vallsta',
  'Segersta',
  'Undersvik',
  'Freluga',
  'Sibo',
  'Hällbo',
  'Växbo',
  'Glösbo',
  'Hanebo',
  'Lottefors',
  'Röste',
  'Simeå',
  'Söräng',
];
const TOWN_BY_KEY = new Map(TOWNS.map((town) => [town.toLocaleLowerCase('sv'), town]));

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

const STREET =
  /\b([A-ZÅÄÖa-zåäö][\p{L}-]{0,40}(?:gatan|gata|vägen|väg|gränden|gränd|torget|torg|allén|allé|stigen|stig|kajen|esplanaden))\s+(\d{1,4}\s?[A-Za-z]?)\b/u;

export interface BollnasWhen {
  date?: string;
  time?: string;
  iso?: string;
}

export interface BollnasItem {
  id: string;
  title: string;
  uri: string;
  desc?: string;
  content?: string;
  location?: string;
  freeEntry?: string;
  categories: string[];
  imageUrl?: string;
  startDate?: BollnasWhen;
  endDate?: BollnasWhen;
}

export interface BollnasRaw {
  now: string;
  origin: string;
  items: BollnasItem[];
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
    throw new Error('bollnas-kommun config.origin is not a URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'bollnas.se' && host !== 'www.bollnas.se')) {
    throw new Error('bollnas-kommun config.origin must be https://bollnas.se');
  }
  return new URL(`https://${host}`);
}

function resourcePathFromConfig(config: Record<string, unknown>): string {
  const raw =
    typeof config.resourcePath === 'string' && config.resourcePath.trim()
      ? config.resourcePath.trim()
      : DEFAULT_RESOURCE_PATH;
  if (
    !raw.startsWith('/appresource/') ||
    raw.includes('..') ||
    raw.includes('?') ||
    raw.toLowerCase().includes('jsessionid')
  ) {
    throw new Error('bollnas-kommun config.resourcePath must be an /appresource path');
  }
  return raw.replace(/\/+$/, '');
}

function pageSizeFromConfig(config: Record<string, unknown>): number {
  const raw = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const size = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error('bollnas-kommun config.pageSize must be 1–50');
  }
  return size;
}

function delayMsFromConfig(config: Record<string, unknown>): number {
  const raw = config.delayMs ?? 200;
  const delay = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(delay) || delay < 0 || delay > 10_000) return 200;
  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameHost(origin: URL, url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.toLowerCase() === origin.hostname.toLowerCase();
}

function responseUrl(response: Response, fallback: URL): URL {
  try {
    return new URL(response.url || fallback);
  } catch {
    return fallback;
  }
}

function itemsUrl(origin: URL, resourcePath: string, start: number): URL {
  const url = new URL(`${resourcePath}/items`, origin);
  url.searchParams.set('start', String(start));
  return url;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function httpsUrl(value: string | undefined, origin: URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, origin);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function prose(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]{2,}/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function descriptionOf(desc: string | undefined, content: string | undefined): string | undefined {
  const intro = prose(desc ?? '');
  const body = prose(content ?? '');
  if (intro && body && !body.toLocaleLowerCase('sv').includes(intro.toLocaleLowerCase('sv'))) {
    return `${intro}\n\n${body}`;
  }
  return body || intro || undefined;
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

function addLink(links: ImportEventLink[], link: ImportEventLink): void {
  const key = eventUrlKey(link.url);
  if (!key) return;
  if (links.some((item) => eventUrlKey(item.url) === key)) return;
  if (links.length >= 10) return;
  const type = socialKind(key) ?? link.type;
  const label = link.label?.trim();
  links.push(label ? { type, url: key, label: label.slice(0, 80) } : { type, url: key });
}

/** The event page is info. Ticket, registration, Facebook, and Instagram URLs keep those types. */
export function linksFor(sourceUrl: string, text: string): ImportEventLink[] {
  const links: ImportEventLink[] = [];
  addLink(links, { type: 'info', url: sourceUrl });
  for (const link of parseLinksFromText(text)) addLink(links, link);
  return links;
}

function lastTown(value: string): string | undefined {
  const tokens = value.toLocaleLowerCase('sv').match(/\p{L}+/gu) ?? [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const town = TOWN_BY_KEY.get(tokens[index] ?? '');
    if (town) return town;
  }
  return undefined;
}

function placeOf(location: string | undefined): {
  venueName?: string;
  street?: string;
  city?: string;
  zipCode?: string;
  address?: string;
} {
  const line = location?.replace(/\s+/g, ' ').trim() ?? '';
  if (!line || /^(digitalt|online|webb)$/i.test(line)) return {};
  const streetMatch = STREET.exec(line);
  const street = streetMatch
    ? `${streetMatch[1]} ${streetMatch[2]}`.replace(/\s+/g, ' ').trim()
    : undefined;
  const city = lastTown(line);
  const zipMatch = /\b(\d{3}\s?\d{2})\b/.exec(line);
  const zipCode = zipMatch?.[1];
  let venue = line;
  if (street) venue = venue.replace(street, ' ');
  if (zipCode) venue = venue.replace(zipCode, ' ');
  venue = venue
    .replace(/[()]/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  if (city) {
    const town = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    venue = venue.replace(new RegExp(`,\\s*${town}$`, 'i'), '').trim();
    if (venue.toLocaleLowerCase('sv') === city.toLocaleLowerCase('sv')) venue = '';
  }
  const address = [street, city].filter(Boolean).join(', ') || undefined;
  return {
    ...(venue ? { venueName: venue } : {}),
    ...(street ? { street } : {}),
    ...(city ? { city } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(address ? { address } : {}),
  };
}

function swedishDate(
  value: string | undefined,
): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})$/i.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const month = MONTHS[match[2]!.toLocaleLowerCase('sv')];
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

function clockOf(value: string | undefined): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function instantOf(when: BollnasWhen | undefined): string | undefined {
  if (!when) return undefined;
  if (when.iso?.trim()) {
    try {
      return sourceDateTime(when.iso);
    } catch {
      // A broken iso falls through to the Swedish date and clock.
    }
  }
  const date = swedishDate(when.date);
  if (!date) return undefined;
  const clock = clockOf(when.time) ?? { hour: 0, minute: 0 };
  return stockholmWallTime({ ...date, ...clock });
}

function ageLimitOf(text: string): number | undefined {
  const match = /åldersgräns\s*:?\s*(\d{1,3})|\bfrån\s+(\d{1,2})\s+år\b/iu.exec(text);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const age = Number(raw);
  return age >= 0 && age <= 120 ? age : undefined;
}

function emailsOf(text: string): string[] {
  return [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) =>
    match[0].toLowerCase(),
  );
}

function organizerNameOf(text: string, venueName: string | undefined): string | undefined {
  const named = /arrangör\s*:\s*([^\n,]{2,80})/i.exec(text);
  const fromText = named?.[1]?.replace(/\s+/g, ' ').trim();
  return fromText || venueName;
}

function isItem(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function parseItem(value: unknown, origin: URL): BollnasItem | null {
  if (!isItem(value)) return null;
  const title = textOf(value.title);
  const uri = httpsUrl(textOf(value.uri), origin);
  const id = textOf(value.id);
  if (!title || !uri || !id) return null;
  const image = isItem(value.image) ? textOf(value.image.uri) : '';
  const fallback = isItem(value.defaultImage) ? textOf(value.defaultImage.uri) : '';
  const imageUrl = httpsUrl(image || fallback, origin);
  const categories = Array.isArray(value.categories)
    ? value.categories.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  const whenOf = (field: unknown): BollnasWhen | undefined => {
    if (!isItem(field)) return undefined;
    const date = textOf(field.date);
    const time = textOf(field.time);
    const iso = textOf(field.iso);
    if (!date && !time && !iso) return undefined;
    return {
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      ...(iso ? { iso } : {}),
    };
  };
  const startDate = whenOf(value.startDate);
  const endDate = whenOf(value.endDate);
  return {
    id,
    title,
    uri,
    ...(textOf(value.desc) ? { desc: textOf(value.desc) } : {}),
    ...(textOf(value.content) ? { content: textOf(value.content) } : {}),
    ...(textOf(value.location) ? { location: textOf(value.location) } : {}),
    ...(textOf(value.freeEntry) ? { freeEntry: textOf(value.freeEntry) } : {}),
    categories: categories.map((item) => item.trim()).slice(0, 20),
    ...(imageUrl ? { imageUrl } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function mapBollnasItem(item: BollnasItem): IncomingEvent {
  const sourceText = `${item.desc ?? ''}\n${item.content ?? ''}`;
  const description = descriptionOf(item.desc, item.content);
  const place = placeOf(item.location);
  const digital = /^(digitalt|online|webb)$/i.test(item.location?.trim() ?? '');
  const startsAt = instantOf(item.startDate);
  const endsAt = instantOf(item.endDate);
  const flag = item.freeEntry?.trim().toLocaleLowerCase('sv');
  const parsed = priceAmountFromText(sourceText.replace(/\bSEK\b/gi, 'kr'));
  const free = flag === 'ja' || (flag !== 'nej' && parsed === 0);
  const priceAmount = free
    ? 0
    : flag === 'nej'
      ? parsed && parsed > 0
        ? parsed
        : undefined
      : parsed;
  const ageLimit = ageLimitOf(sourceText);
  const address = eventAddress({
    address: place.street,
    zipCode: place.zipCode,
    city: place.city,
  });
  const meta: EventMeta = {};
  if (free) meta.freeEntry = true;
  if (ageLimit !== undefined) meta.ageLimit = ageLimit;
  if (address && !digital) meta.address = address;
  const links = linksFor(item.uri, sourceText);
  const organizerName = organizerNameOf(sourceText, place.venueName);
  const online =
    links.find((link) => link.type === 'info' && link.url !== item.uri)?.url ?? item.uri;
  return {
    externalId: item.id,
    title: item.title,
    ...(description ? { description } : {}),
    mode: digital ? 'digital' : 'physical',
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    timezone: 'Europe/Stockholm',
    ...(!digital && place.venueName ? { venueName: place.venueName } : {}),
    ...(!digital && place.address ? { address: place.address } : {}),
    ...(digital ? { onlineUrl: online } : {}),
    ...(priceAmount !== undefined ? { priceAmount, currency: 'SEK' as const } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    links,
    sourceUrl: item.uri,
    organizerKeys: organizerKeys({
      emails: emailsOf(sourceText),
      infoUrls: links.filter((link) => link.type === 'info').map((link) => link.url),
      names: [organizerName],
      town: place.city,
      fallback: ORGANIZER_FALLBACK,
      skipHosts: ['bollnas.se'],
    }),
    ...(organizerName && !digital ? { organizerName } : {}),
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    categoryHints: item.categories,
    tags: [],
  };
}

async function readPage(response: Response): Promise<{ hits: unknown[]; hitCount?: number }> {
  const body: unknown = await response.json();
  if (!isItem(body) || !Array.isArray(body.hits)) {
    throw new Error('bollnas-kommun items response has no hits');
  }
  const hitCount = typeof body.hitCount === 'number' ? body.hitCount : undefined;
  return { hits: body.hits, ...(hitCount !== undefined ? { hitCount } : {}) };
}

async function* eachItem(ctx: SourceRunContext): AsyncGenerator<BollnasRaw> {
  const origin = originFromConfig(ctx.config);
  const resourcePath = resourcePathFromConfig(ctx.config);
  const pageSize = pageSizeFromConfig(ctx.config);
  const delayMs = delayMsFromConfig(ctx.config);
  const seen = new Set<string>();
  let start = 0;
  let hitCount = Number.POSITIVE_INFINITY;
  let yielded = 0;
  for (let page = 0; page < MAX_PAGES && start < hitCount; page += 1) {
    if (ctx.limit != null && yielded >= ctx.limit) break;
    if (page > 0) await sleep(delayMs);
    const url = itemsUrl(origin, resourcePath, start);
    const response = await ctx.fetch(url);
    if (!response.ok) throw new Error(`bollnas-kommun items failed (${response.status})`);
    if (!sameHost(origin, responseUrl(response, url))) {
      throw new Error('bollnas-kommun items redirected off bollnas.se');
    }
    const { hits, hitCount: reported } = await readPage(response);
    if (reported !== undefined) hitCount = reported;
    if (hits.length === 0) break;
    for (const hit of hits) {
      if (ctx.limit != null && yielded >= ctx.limit) break;
      const item = parseItem(hit, origin);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      yielded += 1;
      yield { now: new Date().toISOString(), origin: origin.origin, items: [item] };
    }
    start += pageSize;
    if (hits.length < pageSize) break;
  }
  if (yielded === 0) throw new Error('bollnas-kommun found no usable events');
}

export const bollnasKommun = defineAdapter<BollnasRaw>({
  slug: 'bollnas-kommun',
  kind: 'api',
  each: eachItem,
  async fetchRaw(ctx) {
    let origin = '';
    let now = new Date().toISOString();
    const items: BollnasItem[] = [];
    for await (const raw of eachItem(ctx)) {
      origin = raw.origin;
      now = raw.now;
      items.push(...raw.items);
    }
    return { now, origin, items };
  },
  map(raw) {
    return raw.items.map((item) => mapBollnasItem(item));
  },
});

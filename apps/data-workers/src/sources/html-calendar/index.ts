import type { EventMeta } from '@local-events/contracts';
import {
  eventAddress,
  mergeImportedLinks,
  organizerKeys,
  priceAmountFromText,
  sourceDateTime,
  stockholmWallTime,
  type ImportEventLink,
} from '@local-events/domain';
import { load, type CheerioAPI } from 'cheerio';
import { isPublicHttpsImageUrl } from '../../event-images';
import { defineAdapter, type IncomingEvent, type SourceRunContext } from '@local-events/ingest';

/**
 * One HTML calendar for every site whose events are already in the page.
 * Config is the list URL and the CSS selectors. Cheerio runs those selectors.
 * The list selector finds each event, the link selector is its detail page, and
 * the field selectors read that page. A next selector must be an `a` with an
 * `href`. A button that only has a click handler is not a next page.
 * The worker stays on the list host, skips a `jsessionid` URL, and skips a path
 * robots.txt disallows. A redirect to another host fails the list and skips
 * that detail page.
 * A date with no clock, and a clock with no end, is that instant for both
 * start and end: a whole day. A start and an end on the same date stay a range.
 * Several dates in the date field are occasions. A page with no readable date
 * is still saved. The import does not geocode.
 * A description keeps paragraphs, headings, and list items as separate lines.
 * A line break stays a single line. The links are still read from the HTML.
 */

const DEFAULT_DELAY_MS = 200;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES = 20;
const MAX_EVENTS = 200;
const MAX_SELECTOR = 200;
const MAX_DESCRIPTION = 8_000;
const MAX_OCCASIONS = 30;
const BOT = 'localeventsbot';

const MONTHS: Record<string, number> = {
  januari: 1,
  jan: 1,
  februari: 2,
  feb: 2,
  mars: 3,
  mar: 3,
  april: 4,
  apr: 4,
  maj: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  augusti: 8,
  aug: 8,
  september: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH =
  'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec';
const DATE_RE = new RegExp(
  `(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})[./](\\d{1,2})[./](\\d{4})|(\\d{1,2})\\s+(${MONTH})\\.?\\s+(\\d{4})`,
  'giu',
);
const CLOCK_RE =
  /(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?:\s*[–—-]\s*(?:kl\.?\s*)?(\d{1,2})[:.](\d{2}))?/iu;
const FREE = /(?<![\p{L}])(?:gratis|fritt inträde|fri entré|kostnadsfritt)(?![\p{L}])/iu;
const LABEL = /^(?:plats|adress|lokal|tid|datum|pris|price)\s*:\s*/i;

export interface HtmlCalendarPage {
  pageUrl: string;
  html: string;
  cardHtml: string;
}

export interface HtmlCalendarRaw {
  pages: HtmlCalendarPage[];
}

interface FieldSpec {
  selector: string;
  attr?: string;
}

interface HtmlCalendarFields {
  title: FieldSpec[];
  description: FieldSpec[];
  date: FieldSpec[];
  venue: FieldSpec[];
  address: FieldSpec[];
  city: FieldSpec[];
  price: FieldSpec[];
  image: FieldSpec[];
}

interface HtmlCalendarSettings {
  listUrl: URL;
  item: string;
  link: string;
  next?: string;
  detailRoot?: string;
  detailIgnore?: string;
  fields: HtmlCalendarFields;
  organizerName: string;
  city?: string;
  listOnly: boolean;
  maxPages: number;
  delayMs: number;
}

interface Clock {
  hour: number;
  minute: number;
}

export interface HtmlCalendarOccasion {
  startsAt: string;
  endsAt: string;
}

interface RobotsRule {
  allow: boolean;
  path: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function assertSelector(selector: string, label: string): string {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > MAX_SELECTOR || /[<>]/.test(trimmed)) {
    throw new Error(`html-calendar config.${label} is not a CSS selector`);
  }
  try {
    load('<div></div>')(trimmed);
  } catch {
    throw new Error(`html-calendar config.${label} is not a CSS selector`);
  }
  return trimmed;
}

function fieldSpecs(value: unknown, label: string): FieldSpec[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const specs: FieldSpec[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      specs.push({ selector: assertSelector(item, label) });
      continue;
    }
    const record = recordOf(item);
    const selector = textOf(record?.selector);
    if (!selector) throw new Error(`html-calendar config.${label} is not a CSS selector`);
    const attr = textOf(record?.attr);
    if (attr && !/^[A-Za-z][\w:-]{0,40}$/.test(attr)) {
      throw new Error(`html-calendar config.${label} attr is not an attribute name`);
    }
    specs.push({
      selector: assertSelector(selector, label),
      ...(attr ? { attr } : {}),
    });
  }
  return specs;
}

export function htmlCalendarSettings(config: Record<string, unknown>): HtmlCalendarSettings {
  const listUrl = textOf(config.listUrl);
  if (!listUrl || !isPublicHttpsImageUrl(listUrl)) {
    throw new Error('html-calendar config.listUrl must be a public https URL');
  }
  const fields = recordOf(config.fields);
  const title = fieldSpecs(fields?.title, 'fields.title');
  if (title.length === 0) throw new Error('html-calendar config.fields.title is required');
  const organizerName = textOf(config.organizerName);
  if (!organizerName) throw new Error('html-calendar config.organizerName is required');
  const maxPages = config.maxPages == null ? DEFAULT_MAX_PAGES : Number(config.maxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) {
    throw new Error(`html-calendar config.maxPages must be 1–${MAX_PAGES}`);
  }
  const delayMs = config.delayMs == null ? DEFAULT_DELAY_MS : Number(config.delayMs);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10_000) {
    throw new Error('html-calendar config.delayMs must be 0–10000');
  }
  const next = textOf(config.next);
  const detailRoot = textOf(config.detailRoot);
  const detailIgnore = textOf(config.detailIgnore);
  return {
    listUrl: new URL(listUrl),
    item: assertSelector(textOf(config.item) ?? '', 'item'),
    link: assertSelector(textOf(config.link) ?? '', 'link'),
    ...(next ? { next: assertSelector(next, 'next') } : {}),
    ...(detailRoot ? { detailRoot: assertSelector(detailRoot, 'detailRoot') } : {}),
    ...(detailIgnore ? { detailIgnore: assertSelector(detailIgnore, 'detailIgnore') } : {}),
    fields: {
      title,
      description: fieldSpecs(fields?.description, 'fields.description'),
      date: fieldSpecs(fields?.date, 'fields.date'),
      venue: fieldSpecs(fields?.venue, 'fields.venue'),
      address: fieldSpecs(fields?.address, 'fields.address'),
      city: fieldSpecs(fields?.city, 'fields.city'),
      price: fieldSpecs(fields?.price, 'fields.price'),
      image: fieldSpecs(fields?.image, 'fields.image'),
    },
    organizerName,
    ...(textOf(config.city) ? { city: textOf(config.city) } : {}),
    listOnly: config.listOnly === true,
    maxPages,
    delayMs,
  };
}

function sameHost(left: URL, right: URL): boolean {
  return left.hostname.toLowerCase() === right.hostname.toLowerCase();
}

function responseUrl(response: Response, requested: URL): URL {
  if (!response.url) return requested;
  try {
    return new URL(response.url);
  } catch {
    return requested;
  }
}

function hasSessionId(url: URL): boolean {
  return /;jsessionid=/i.test(`${url.pathname}${url.search}`);
}

function robotsGroups(body: string): { agents: string[]; rules: RobotsRule[] }[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let inAgents = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === 'user-agent') {
      if (!inAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
        inAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    inAgents = false;
    if (!current || (key !== 'allow' && key !== 'disallow') || !value) continue;
    current.rules.push({ allow: key === 'allow', path: value });
  }
  return groups;
}

function groupScore(agents: string[]): number {
  let best = 0;
  for (const agent of agents) {
    if (agent === '*') best = Math.max(best, 1);
    else if (BOT.startsWith(agent) || agent.startsWith(BOT))
      best = Math.max(best, agent.length + 1);
  }
  return best;
}

function ruleMatches(rule: string, target: string): boolean {
  const end = rule.endsWith('$');
  const body = end ? rule.slice(0, -1) : rule;
  const pattern = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(end ? `^${pattern}$` : `^${pattern}`).test(target);
}

/** Longest matching Allow or Disallow wins. No match allows the URL. */
export function robotsAllows(body: string, url: URL): boolean {
  const groups = robotsGroups(body);
  let chosen: RobotsRule[] = [];
  let score = 0;
  for (const group of groups) {
    const next = groupScore(group.agents);
    if (next > score) {
      score = next;
      chosen = group.rules;
    }
  }
  const target = `${url.pathname}${url.search}`;
  let winner: { allow: boolean; length: number } | undefined;
  for (const rule of chosen) {
    if (!ruleMatches(rule.path, target)) continue;
    const length = rule.path.length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) {
      winner = { allow: rule.allow, length };
    }
  }
  return winner ? winner.allow : true;
}

function assertFetchable(url: URL, robots: string, list: URL): void {
  if (!isPublicHttpsImageUrl(url.href) || !sameHost(list, url) || hasSessionId(url)) {
    throw new Error('html-calendar refused a url off the calendar host');
  }
  if (!robotsAllows(robots, url))
    throw new Error(`html-calendar robots.txt disallows ${url.pathname}`);
}

function clockOf(hour: number, minute: number): Clock | undefined {
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function atWall(year: number, month: number, day: number, clock?: Clock): string {
  return stockholmWallTime({
    year,
    month,
    day,
    hour: clock?.hour ?? 0,
    minute: clock?.minute ?? 0,
  });
}

function dateParts(
  match: RegExpExecArray,
): { year: number; month: number; day: number } | undefined {
  if (match[1]) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return { year, month, day };
  }
  if (match[4]) {
    const day = Number(match[4]);
    const month = Number(match[5]);
    const year = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return { year, month, day };
  }
  const month = MONTHS[(match[8] ?? '').toLowerCase()];
  const day = Number(match[7]);
  const year = Number(match[9]);
  if (!month || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

function singleTimestamp(value: string): HtmlCalendarOccasion[] | undefined {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return undefined;
  if (/\d{4}-\d{2}-\d{2}[T ]/.test(value.slice(10))) return undefined;
  try {
    const startsAt = sourceDateTime(value);
    return [{ startsAt, endsAt: startsAt }];
  } catch {
    return undefined;
  }
}

/** Swedish dates in a selector's text. A `Z` or a numeric offset is that instant. */
export function htmlCalendarOccasions(text: string): HtmlCalendarOccasion[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  const single = singleTimestamp(trimmed);
  if (single) return single;
  const occasions: HtmlCalendarOccasion[] = [];
  const seen = new Set<string>();
  for (const match of trimmed.matchAll(DATE_RE)) {
    const parts = dateParts(match);
    if (!parts || match.index == null) continue;
    const after = trimmed.slice(match.index + match[0].length, match.index + match[0].length + 80);
    const clock = CLOCK_RE.exec(after);
    const start = clock ? clockOf(Number(clock[1]), Number(clock[2])) : undefined;
    const end = clock?.[3] ? clockOf(Number(clock[3]), Number(clock[4])) : undefined;
    const startsAt = atWall(parts.year, parts.month, parts.day, start);
    const endsAt =
      start &&
      end &&
      (end.hour > start.hour || (end.hour === start.hour && end.minute > start.minute))
        ? atWall(parts.year, parts.month, parts.day, end)
        : startsAt;
    const key = `${startsAt}|${endsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    occasions.push({ startsAt, endsAt });
    if (occasions.length >= MAX_OCCASIONS) break;
  }
  occasions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return occasions;
}

function valuesOf($: CheerioAPI, specs: FieldSpec[]): string[] {
  const values: string[] = [];
  for (const spec of specs) {
    $(spec.selector).each((_, element) => {
      const node = $(element);
      const attr = spec.attr ?? (node.is('img') ? 'src' : undefined);
      const value = (attr ? node.attr(attr) : node.text())?.replace(/\s+/g, ' ').trim();
      if (value) values.push(value);
    });
    if (values.length > 0) return values;
  }
  return values;
}

function firstValue($: CheerioAPI, specs: FieldSpec[]): string | undefined {
  return valuesOf($, specs)[0];
}

function joined($: CheerioAPI, specs: FieldSpec[]): string | undefined {
  const text = valuesOf($, specs).join(' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

const PARAGRAPH =
  'address, article, blockquote, div, figcaption, figure, h1, h2, h3, h4, h5, h6, p, pre, section';

function blockText($: CheerioAPI, specs: FieldSpec[]): string | undefined {
  for (const spec of specs) {
    const nodes = $(spec.selector);
    if (nodes.length === 0) continue;
    const chunks: string[] = [];
    nodes.each((_, element) => {
      const clone = $(element).clone();
      clone.find('script, style, noscript, template').remove();
      clone.find('br').replaceWith('\n');
      clone.find('li, tr, dt, dd').append('\n');
      clone.find(PARAGRAPH).before('\n').after('\n');
      chunks.push(clone.text());
    });
    const text = chunks
      .join('\n')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) return text;
  }
  return undefined;
}

function htmlOf($: CheerioAPI, specs: FieldSpec[]): string {
  for (const spec of specs) {
    const chunks: string[] = [];
    $(spec.selector).each((_, element) => {
      const html = $(element).html();
      if (html) chunks.push(html);
    });
    if (chunks.length > 0) return chunks.join('\n');
  }
  return '';
}

function scopedHtml(
  html: string,
  root: string | undefined,
  ignore: string | undefined,
): CheerioAPI {
  const $ = load(html);
  if (ignore) $(ignore).remove();
  if (!root) return $;
  const match = $(root).first();
  if (!match.length) return $;
  return load(match.html() ?? '');
}

function stripLabel(value: string | undefined): string | undefined {
  const text = value?.replace(LABEL, '').trim();
  return text || undefined;
}

function priceOf(text: string | undefined): { amount?: number; free: boolean } {
  if (!text) return { free: false };
  const amount = priceAmountFromText(text.replace(/\bSEK\b/gi, 'kr'));
  if (amount === 0 || (amount == null && FREE.test(text))) return { amount: 0, free: true };
  return { amount, free: false };
}

function addressOf(addressText: string | undefined, cityText: string | undefined) {
  const text = stripLabel(addressText);
  const found = text?.match(/(\d{3})\s?(\d{2})/);
  const zip = found ? `${found[1]}${found[2]}` : undefined;
  let street = text;
  let city = stripLabel(cityText);
  if (text && found && found.index != null) {
    const before = text
      .slice(0, found.index)
      .replace(/[,\s]+$/, '')
      .trim();
    street = before || undefined;
    if (!city) {
      city = text
        .slice(found.index + found[0].length)
        .replace(/^[,\s]+/, '')
        .split(/[,.]/)[0]
        ?.trim();
    }
  }
  return eventAddress({ address: street, zipCode: zip, city });
}

function imageUrls(values: string[], page: URL): string[] {
  const urls: string[] = [];
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value, page);
    } catch {
      continue;
    }
    if (!isPublicHttpsImageUrl(url.href) || /\.svg(?:$|\?)/i.test(url.pathname)) continue;
    if (!urls.includes(url.href)) urls.push(url.href);
    if (urls.length >= 9) break;
  }
  return urls;
}

function externalIdOf(url: URL): string {
  let path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  return `${path}${url.search}`.slice(0, 300);
}

export function mapHtmlCalendar(
  raw: HtmlCalendarPage,
  config: Record<string, unknown>,
  slug: string,
): IncomingEvent | null {
  const settings = htmlCalendarSettings(config);
  let page: URL;
  try {
    page = new URL(raw.pageUrl);
  } catch {
    return null;
  }
  if (!sameHost(settings.listUrl, page)) return null;
  const ignore = raw.html === raw.cardHtml ? undefined : settings.detailIgnore;
  const detail = scopedHtml(raw.html, settings.detailRoot, ignore);
  const card = load(`<div id="html-calendar-card">${raw.cardHtml}</div>`);
  const read = (specs: FieldSpec[], join: boolean): string | undefined =>
    (join ? joined(detail, specs) : firstValue(detail, specs)) ??
    (join ? joined(card, specs) : firstValue(card, specs));
  const title = stripLabel(read(settings.fields.title, false));
  if (!title) return null;
  const descriptionText = (
    blockText(detail, settings.fields.description) ?? blockText(card, settings.fields.description)
  )?.slice(0, MAX_DESCRIPTION);
  const descriptionHtml = htmlOf(detail, settings.fields.description);
  const occasions = htmlCalendarOccasions(read(settings.fields.date, true) ?? '').slice(
    0,
    MAX_OCCASIONS,
  );
  const venueName = stripLabel(read(settings.fields.venue, false));
  const city = stripLabel(read(settings.fields.city, false)) ?? settings.city;
  const place = addressOf(read(settings.fields.address, true), city);
  const price = priceOf(read(settings.fields.price, true));
  const images = imageUrls(
    valuesOf(detail, settings.fields.image).concat(valuesOf(card, settings.fields.image)),
    page,
  );
  const meta: EventMeta = {};
  if (price.free) meta.freeEntry = true;
  if (place) meta.address = place;
  const links: ImportEventLink[] = [{ type: 'info', url: page.href }];
  const merged = mergeImportedLinks(links, descriptionHtml || descriptionText) ?? links;
  const first = occasions[0];
  const last = occasions.at(-1);
  const withVenue = occasions.map((occasion) => ({
    ...occasion,
    ...(venueName ? { venueName } : {}),
    sourceKey: occasion.startsAt,
  }));
  return {
    externalId: externalIdOf(page),
    title,
    ...(descriptionText ? { description: descriptionText } : {}),
    mode: 'physical',
    ...(first ? { startsAt: first.startsAt } : {}),
    ...(last ? { endsAt: last.endsAt } : {}),
    ...(withVenue.length > 0 ? { occasions: withVenue } : {}),
    timezone: 'Europe/Stockholm',
    ...(venueName ? { venueName } : {}),
    ...(place?.address || place?.city
      ? { address: [place.address, place.city].filter(Boolean).join(', ') }
      : {}),
    ...(price.amount !== undefined ? { priceAmount: price.amount, currency: 'SEK' as const } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    links: merged,
    sourceUrl: page.href,
    organizerKeys: organizerKeys({
      names: [settings.organizerName],
      skipHosts: [settings.listUrl.hostname],
      fallback: slug,
    }),
    organizerName: settings.organizerName,
    categoryHints: [],
    tags: [],
    ...(images[0] ? { imageUrl: images[0] } : {}),
    ...(images.length > 1 ? { imageUrls: images.slice(1, 9) } : {}),
  };
}

interface ListedEvent {
  url: URL;
  cardHtml: string;
}

function listedEvents($: CheerioAPI, settings: HtmlCalendarSettings, page: URL): ListedEvent[] {
  const found: ListedEvent[] = [];
  $(settings.item).each((_, element) => {
    const item = $(element);
    const link = item.find(settings.link);
    const node = link.length ? link.first() : item.filter(settings.link).first();
    const href = node.attr('href') ?? (item.is('a') ? item.attr('href') : undefined);
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return;
    }
    url.hash = '';
    if (!isPublicHttpsImageUrl(url.href) || !sameHost(settings.listUrl, url) || hasSessionId(url))
      return;
    if (found.some((event) => event.url.href === url.href)) return;
    found.push({ url, cardHtml: $.html(item) ?? '' });
  });
  return found;
}

function nextPage($: CheerioAPI, settings: HtmlCalendarSettings, page: URL): URL | undefined {
  if (!settings.next) return undefined;
  const href = $(settings.next).first().attr('href');
  if (!href) return undefined;
  try {
    const url = new URL(href, page);
    url.hash = '';
    if (!isPublicHttpsImageUrl(url.href) || !sameHost(settings.listUrl, url) || hasSessionId(url)) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

async function fetchText(
  ctx: SourceRunContext,
  url: URL,
  robots: string,
  list: URL,
): Promise<{ url: URL; html: string }> {
  assertFetchable(url, robots, list);
  const response = await ctx.fetch(url);
  if (!response.ok) throw new Error(`html-calendar ${url.pathname} failed (${response.status})`);
  const finalUrl = responseUrl(response, url);
  if (!sameHost(list, finalUrl) || hasSessionId(finalUrl)) {
    throw new Error('html-calendar redirected off the calendar host');
  }
  if (!robotsAllows(robots, finalUrl)) {
    throw new Error(`html-calendar robots.txt disallows ${finalUrl.pathname}`);
  }
  return { url: finalUrl, html: await response.text() };
}

async function* eachEvent(ctx: SourceRunContext): AsyncGenerator<HtmlCalendarRaw> {
  const settings = htmlCalendarSettings(ctx.config);
  const robotsUrl = new URL('/robots.txt', settings.listUrl);
  const robotsResponse = await ctx.fetch(robotsUrl);
  if (!robotsResponse.ok && robotsResponse.status !== 404) {
    throw new Error(`html-calendar robots.txt failed (${robotsResponse.status})`);
  }
  const robotsFinal = responseUrl(robotsResponse, robotsUrl);
  if (!sameHost(settings.listUrl, robotsFinal)) {
    throw new Error('html-calendar robots.txt redirected off the calendar host');
  }
  const robots = robotsResponse.ok ? await robotsResponse.text() : '';
  assertFetchable(settings.listUrl, robots, settings.listUrl);

  const seenPages = new Set<string>();
  const seenEvents = new Set<string>();
  let page = settings.listUrl;
  let yielded = 0;
  let found = 0;
  for (let index = 0; index < settings.maxPages && yielded < MAX_EVENTS; index += 1) {
    if (seenPages.has(page.href)) break;
    seenPages.add(page.href);
    if (index > 0) await sleep(settings.delayMs);
    const list = await fetchText(ctx, page, robots, settings.listUrl);
    const $ = load(list.html);
    const events = listedEvents($, settings, list.url);
    found += events.length;
    for (const event of events) {
      if (ctx.limit != null && yielded >= ctx.limit) return;
      if (yielded >= MAX_EVENTS || seenEvents.has(event.url.href)) continue;
      seenEvents.add(event.url.href);
      if (!robotsAllows(robots, event.url)) {
        ctx.log('html-calendar skipped a disallowed event page', { url: event.url.href });
        continue;
      }
      if (settings.listOnly) {
        yielded += 1;
        yield {
          pages: [{ pageUrl: event.url.href, html: event.cardHtml, cardHtml: event.cardHtml }],
        };
        continue;
      }
      await sleep(settings.delayMs);
      let detail: { url: URL; html: string };
      try {
        detail = await fetchText(ctx, event.url, robots, settings.listUrl);
      } catch (error) {
        ctx.log('html-calendar skipped event page', {
          url: event.url.href,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      yielded += 1;
      yield {
        pages: [{ pageUrl: detail.url.href, html: detail.html, cardHtml: event.cardHtml }],
      };
    }
    const next = nextPage($, settings, list.url);
    if (!next || seenPages.has(next.href) || !robotsAllows(robots, next)) break;
    page = next;
  }
  if (found > 0 && yielded === 0) throw new Error('html-calendar event pages had no usable events');
  if (yielded === 0) throw new Error('html-calendar found no events');
}

export function htmlCalendarSource(slug: string) {
  return defineAdapter<HtmlCalendarRaw>({
    slug,
    kind: 'scraper',
    each: eachEvent,
    async fetchRaw(ctx) {
      const pages: HtmlCalendarPage[] = [];
      for await (const raw of eachEvent(ctx)) pages.push(...raw.pages);
      return { pages };
    },
    map(raw, ctx) {
      return raw.pages.flatMap((page) => {
        const mapped = mapHtmlCalendar(page, ctx.config, ctx.sourceSlug);
        return mapped ? [mapped] : [];
      });
    },
  });
}

export const htmlCalendar = htmlCalendarSource('html-calendar');

/** Sites that share this adapter. Each one is its own data_sources row. */
export const HTML_CALENDAR_SLUGS = [
  'html-calendar',
  'halsinglands-museum',
  'systrarna',
  'folkteatern-gavleborg',
  'ovanaker',
  'abf-halsingland',
] as const;

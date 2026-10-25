/**
 * Ask a local Ollama model to pick existing tags for an event.
 * The model may only return ids from the catalog, each with a fit score.
 * A missing server leaves the event untagged.
 */

import { sourceDateTime, stockholmWallTime } from '@local-events/domain';

export interface TagChoice {
  externalId: string;
  name: string;
}

export interface TagMatchInput {
  title: string;
  description?: string;
  venue?: string;
}

const useQwen3 = true;

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = useQwen3 ? 'qwen3:8b' : 'qwen2.5:3b';
const DESCRIPTION_LIMIT = 1_200;
const MAX_TAGS = 5;
/** Festival-specific tags the model must not attach to ordinary events. */
const EXCLUDED_TAG_SLUGS = new Set(['soderhamns-kulturfestival']);

export function ollamaBaseUrl(config: Record<string, unknown>): URL {
  const fromConfig = typeof config.ollamaBaseUrl === 'string' ? config.ollamaBaseUrl.trim() : '';
  const raw = fromConfig || process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ollama base URL is not a URL');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !loopback) {
    throw new Error('ollama base URL must be a loopback http URL');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url;
}

export function ollamaModel(config: Record<string, unknown>): string {
  const fromConfig = typeof config.ollamaModel === 'string' ? config.ollamaModel.trim() : '';
  const model = fromConfig || process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^[\w.:-]{1,80}$/.test(model)) throw new Error('ollama model name is invalid');
  return model;
}

/** `OLLAMA_DISABLED=1` skips every tag lookup. Stored tags are left as they are. */
export function ollamaDisabled(): boolean {
  const raw = process.env.OLLAMA_DISABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export interface StoredEventTag {
  externalId: string;
  tag: TagChoice;
}

/** Tags already stored for this source, keyed by the event's external id. */
export function existingEventTags(config: Record<string, unknown>): StoredEventTag[] {
  const raw = config.existingEventTags;
  if (!Array.isArray(raw)) return [];
  const rows: StoredEventTag[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const externalId = 'externalId' in item ? item.externalId : undefined;
    const tag = 'tag' in item ? item.tag : undefined;
    if (typeof externalId !== 'string' || !tag || typeof tag !== 'object') continue;
    const eventId = externalId.trim();
    const tagId =
      'externalId' in tag && typeof tag.externalId === 'string' ? tag.externalId.trim() : '';
    const name = 'name' in tag && typeof tag.name === 'string' ? tag.name.trim() : '';
    if (!eventId || !tagId || !name) continue;
    rows.push({ externalId: eventId, tag: { externalId: tagId, name } });
  }
  return rows;
}

/**
 * Tags already on events from this product. Null when none of them have a tag,
 * so the caller still asks the model.
 */
export function keptTagsForProduct(
  productId: string,
  existing: StoredEventTag[],
): { externalId: string; tags: TagChoice[] }[] | null {
  const prefix = `${productId}:`;
  const grouped = new Map<string, TagChoice[]>();
  for (const row of existing) {
    if (!row.externalId.startsWith(prefix)) continue;
    const list = grouped.get(row.externalId) ?? [];
    if (!list.some((tag) => tag.externalId === row.tag.externalId)) list.push(row.tag);
    grouped.set(row.externalId, list);
  }
  if (grouped.size === 0) return null;
  return [...grouped.entries()].map(([externalId, tags]) => ({ externalId, tags }));
}

export function tagCatalog(config: Record<string, unknown>): TagChoice[] {
  const raw = config.tagCatalog;
  if (!Array.isArray(raw)) return [];
  const choices: TagChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const externalId = 'externalId' in item ? item.externalId : undefined;
    const name = 'name' in item ? item.name : undefined;
    const slug = 'slug' in item && typeof item.slug === 'string' ? item.slug.trim() : '';
    if (typeof externalId !== 'string' || typeof name !== 'string') continue;
    if (EXCLUDED_TAG_SLUGS.has(slug)) continue;
    const id = externalId.trim();
    const label = name.trim();
    if (!id || !label) continue;
    choices.push({ externalId: id, name: label });
  }
  return choices;
}

function idText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return '';
}

function resolveTagId(raw: string, catalog: TagChoice[]): TagChoice | null {
  const exact = catalog.find((tag) => tag.externalId === raw);
  if (exact) return exact;
  const suffix = catalog.filter((tag) => tag.externalId.endsWith(`:${raw}`));
  return suffix.length === 1 ? suffix[0]! : null;
}

function scoreValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** Catalog ids the model listed, in that order. A missing score is not a tag. */
function scoredIds(parsed: LLMScanResult): string[] {
  if (!('possibleTags' in parsed) || !Array.isArray(parsed.possibleTags)) return [];
  const ids: string[] = [];
  for (const item of parsed.possibleTags) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item ? idText(item.id) : '';
    const score = 'score' in item ? scoreValue(item.score) : null;
    if (!id || score === null) continue;
    ids.push(id);
  }
  return ids;
}

/** Up to five catalog tags. Unknown ids are dropped. A bare numeric id matches `prefix:id`. */
export function parseTagChoices(input: LLMScanResult, catalog: TagChoice[]): TagChoice[] {
  const chosen: TagChoice[] = [];
  for (const id of scoredIds(input)) {
    if (chosen.length >= MAX_TAGS) break;
    const tag = resolveTagId(id, catalog);
    if (!tag || chosen.some((item) => item.externalId === tag.externalId)) continue;
    chosen.push(tag);
  }
  return chosen;
}

export type TagMatchResult = { ok: true; tags: TagChoice[] } | { ok: false };

export type LLMScanResult = {
  possiblePublishers: { publisherId: string; rank: number }[];
  possibleDuplicates: { eventId: string; rank: number; occasionRank: number }[];
  contentVerdict: 'spam' | 'harmful' | 'safe' | 'unknown';
  possibleTags: { id: string; score: number }[];
  summary: string;
  language: string;
  /** Steps from the description. Empty when the model listed none. */
  instructions: string[];
  /** Both set when the model found a range. Null when it did not. */
  startsAt: string | null;
  endsAt: string | null;
  /** Venue guesses. The scan writes the highest rank above 80 on every occasion. */
  possibleVenueNames: { name: string; rank: number }[];
  /** Street, postcode, and city from the description or the event page. Absent when the model found none. */
  address?: {
    address?: string;
    zipCode?: string;
    city?: string;
    country?: 'Sweden';
  };
};

const INSTRUCTION_LIMIT = 20;
const INSTRUCTION_LENGTH = 500;

/**
 * A tip field named in parentheses. The scan sometimes restates the tip chat
 * (`place:`, `confirm: place`) as a step such as "Bekräfta platsen (place)".
 */
const TIP_FIELD_STEP =
  /\((?:place|link|description|title|price|startDate|startTime|endDate|endTime|startsAt|endsAt)\)/i;

/** Keeps non-empty visitor steps from the scan JSON. At most 20, each at most 500 characters. */
export function readScanInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const steps: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const step = item.trim();
    if (!step || TIP_FIELD_STEP.test(step)) continue;
    steps.push(step.slice(0, INSTRUCTION_LENGTH));
    if (steps.length >= INSTRUCTION_LIMIT) break;
  }
  return steps;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** One clock from the scan JSON. A bare date is the start or end of that Stockholm day. */
function scanInstant(value: unknown, end: boolean): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = DATE_ONLY.exec(trimmed);
  if (date) {
    return stockholmWallTime({
      year: Number(date[1]),
      month: Number(date[2]),
      day: Number(date[3]),
      hour: end ? 23 : 0,
      minute: end ? 59 : 0,
      second: end ? 59 : 0,
    });
  }
  try {
    return sourceDateTime(trimmed);
  } catch {
    return null;
  }
}

/**
 * Start and end from the scan JSON. Both are required, and the end is not before
 * the start. A missing or one-sided range is null.
 */
export function readScanRange(value: unknown): { startsAt: string; endsAt: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { startsAt?: unknown; endsAt?: unknown };
  const startsAt = scanInstant(record.startsAt, false);
  const endsAt = scanInstant(record.endsAt, true);
  if (!startsAt || !endsAt) return null;
  if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) return null;
  return { startsAt, endsAt };
}

export type LLMOutput = LLMScanResult & {
  output: object;
};

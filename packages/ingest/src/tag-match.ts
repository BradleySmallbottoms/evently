/**
 * Ask a local Ollama model to pick existing tags for an event.
 * The model may only return ids from the catalog, each with a fit score.
 * Scores of 90 or below are dropped. A missing server leaves the event untagged.
 */

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
/** Tags at this score or below are not a good enough match. */
const MIN_SCORE = 90;
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

/** Catalog ids whose fit score is above {@link MIN_SCORE}. */
function scoredIds(parsed: object): string[] {
  if (!('externalIds' in parsed) || !Array.isArray(parsed.externalIds)) return [];
  const ids: string[] = [];
  for (const item of parsed.externalIds) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item ? idText(item.id) : '';
    const score = 'score' in item ? scoreValue(item.score) : null;
    if (!id || score === null || score <= MIN_SCORE) continue;
    ids.push(id);
  }
  return ids;
}

/** Up to five catalog tags with a score above 90. Unknown ids are dropped. A bare numeric id matches `prefix:id`. */
export function parseTagChoices(body: string, catalog: TagChoice[]): TagChoice[] {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const chosen: TagChoice[] = [];
  for (const id of scoredIds(parsed)) {
    if (chosen.length >= MAX_TAGS) break;
    const tag = resolveTagId(id, catalog);
    if (!tag || chosen.some((item) => item.externalId === tag.externalId)) continue;
    chosen.push(tag);
  }
  return chosen;
}

export function tagMatchPrompt(event: TagMatchInput, catalog: TagChoice[]): string {
  const lines = catalog.map((tag) => `${tag.externalId} | ${tag.name}`);
  const description = event.description?.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
  return [
    'För varje tagg, bedöm hur väl den passar evenemanget från 0 till 100 och skapa en lista med taggar som får en poäng över 90.',
    'Svara bara med JSON: {"externalIds":[{"id":"<id>","score":<score>}]} eller {"externalIds":[]} om ingen tagg passar.',
    'Taggar:',
    ...lines,
    'Evenemang:',
    `Titel: ${event.title}`,
    ...(event.venue ? [`Plats: ${event.venue}`] : []),
    ...(description ? [`Beskrivning: ${description}`] : []),
  ].join('\n');
}

export type TagMatchResult = { ok: true; tags: TagChoice[] } | { ok: false };

/** Up to five catalog tags with a score above 90, none, or a failed local call. */
export async function matchEventTag(
  event: TagMatchInput,
  catalog: TagChoice[],
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<TagMatchResult> {
  if (catalog.length === 0) return { ok: true, tags: [] };
  if (ollamaDisabled()) return { ok: true, tags: [] };
  let base: URL;
  let model: string;
  try {
    base = ollamaBaseUrl(config);
    model = ollamaModel(config);
  } catch {
    console.log('Ollama base URL or model is not valid');
    return { ok: false };
  }
  const url = new URL('/api/chat', base);
  let response: Response;
  try {
    console.log('Running Ollama request with model ', model, 'on event with title ', event.title);
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [{ role: 'user', content: tagMatchPrompt(event, catalog) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    console.log('Error fetching Ollama response', e);
    return { ok: false };
  }
  if (!response.ok) {
    console.log(
      'Ollama request failed with status',
      response.status,
      'and body',
      await response.text(),
    );
    return { ok: false };
  }
  let payload: unknown;
  try {
    payload = await response.json();
    console.log('Ollama response', payload);
  } catch (e) {
    console.log('Error parsing Ollama response', e);
    return { ok: false };
  }
  const content =
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    payload.message &&
    typeof payload.message === 'object' &&
    'content' in payload.message &&
    typeof payload.message.content === 'string'
      ? payload.message.content
      : '';
  const tags = parseTagChoices(content, catalog);
  return { ok: true, tags };
}

/**
 * Ask a local Ollama model to pick at most one existing tag for an event.
 * The model may only return an id from the catalog. A missing server leaves the event untagged.
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

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:32b'; //'qwen2.5:3b';
const DESCRIPTION_LIMIT = 1_200;

export function ollamaBaseUrl(config: Record<string, unknown>): URL {
  const fromConfig = typeof config.ollamaBaseUrl === 'string' ? config.ollamaBaseUrl.trim() : '';
  const raw = fromConfig || process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('glada-hudik ollama base URL is not a URL');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !loopback) {
    throw new Error('glada-hudik ollama base URL must be a loopback http URL');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url;
}

export function ollamaModel(config: Record<string, unknown>): string {
  const fromConfig = typeof config.ollamaModel === 'string' ? config.ollamaModel.trim() : '';
  const model = fromConfig || process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^[\w.:-]{1,80}$/.test(model)) throw new Error('glada-hudik ollama model name is invalid');
  return model;
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
    if (typeof externalId !== 'string' || typeof name !== 'string') continue;
    const id = externalId.trim();
    const label = name.trim();
    if (!id || !label) continue;
    choices.push({ externalId: id, name: label });
  }
  return choices;
}

export function parseTagChoice(body: string, catalog: TagChoice[]): TagChoice | null {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('externalId' in parsed)) return null;
  const id = parsed.externalId;
  if (typeof id !== 'string') return null;
  return catalog.find((tag) => tag.externalId === id.trim()) ?? null;
}

function promptFor(event: TagMatchInput, catalog: TagChoice[]): string {
  const lines = catalog.map((tag) => `${tag.externalId} | ${tag.name}`);
  const description = event.description?.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
  return [
    'Välj minst en tagg som passar evenemanget. Hitta inte på ett id.',
    'Svara bara med JSON: {"externalId":"<id>"} eller {"externalId":null} om ingen tagg passar.',
    'Taggar:',
    ...lines,
    'Evenemang:',
    `Titel: ${event.title}`,
    ...(event.venue ? [`Plats: ${event.venue}`] : []),
    ...(description ? [`Beskrivning: ${description}`] : []),
  ].join('\n');
}

export type TagMatchResult = { ok: true; tag: TagChoice | null } | { ok: false };

/** One catalog tag, none, or a failed local call. */
export async function matchEventTag(
  event: TagMatchInput,
  catalog: TagChoice[],
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<TagMatchResult> {
  if (catalog.length === 0) return { ok: true, tag: null };
  let base: URL;
  let model: string;
  try {
    base = ollamaBaseUrl(config);
    model = ollamaModel(config);
  } catch {
    return { ok: false };
  }
  const url = new URL('/api/chat', base);
  let response: Response;
  try {
    console.log('Running Ollama request with model ', model);
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [{ role: 'user', content: promptFor(event, catalog) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (e) {
    console.log('error', e);
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
  console.log('Ollama response', content);
  return { ok: true, tag: parseTagChoice(content, catalog) };
}

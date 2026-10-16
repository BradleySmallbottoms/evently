import type { Db } from '@local-events/db';
import { pointEwkt, schema } from '@local-events/db';
import {
  anyLinksMatch,
  choosePublisher,
  duplicateIdsMatch,
  duplicateLinksMatch,
  duplicateSignal,
  preferDuplicate,
  withinDuplicateWindow,
  type DuplicateSignal,
} from '@local-events/domain';
import { distanceMeters, type GeoPoint } from '@local-events/geo';
import {
  ollamaBaseUrl,
  ollamaDisabled,
  ollamaModel,
  parseTagChoices,
  titleSimilarity,
  type LLMOutput,
  type LLMScanResult,
  type TagChoice,
  type TagMatchInput,
} from '@local-events/ingest';
import { and, eq, gte, isNotNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { LOCAL_ORGANIZER_SLUGS } from '../sources';
import type { DuplicateCandidate, IngestStore } from '../store';
import type { ChosenPublisher, PossibleDuplicateMatch, PromptRunner, ScanInput, ScanOutcome } from './types';

/** How long one Ollama request may run before the scan gives up on it. */
const CHAT_TIMEOUT_MS = 90_000;
/** Tool rounds for one event. The last round still has to be a text answer, or the scan is unavailable. */
const MAX_TOOL_ROUNDS = 4;
const DESCRIPTION_LIMIT = 1_200;
/** Fixed search radius. The model cannot widen it. */
const NEARBY_RADIUS_M = 5_000;
const NEARBY_DAYS_BEFORE = 1;
const NEARBY_DAYS_AFTER = 1;
const NEARBY_RESULT_LIMIT = 20;
/** How many tool calls from one model reply are run. Extra calls are ignored. */
const MAX_TOOL_CALLS_PER_ROUND = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OllamaWithToolsRunnerOptions {
  config?: Record<string, unknown>;
  /** Tests pass this so a scan does not call a running Ollama. */
  fetch?: typeof fetch;
  /**
   * Postgres connection for nearby lookups. A memory store is read from its
   * own rows and does not need this.
   */
  db?: Db;
}

interface NearbyEventHit {
  id: string;
  title: string;
  startsAt: string;
  venue: string | null;
  distanceM: number;
}

interface NearbyPublisherHit {
  id: string;
  name: string;
  verified: boolean;
  temporary: boolean;
  nearestEventTitle: string;
  distanceM: number;
}

interface NearbyWindow {
  from: Date;
  to: Date;
}

/** Rows a memory store already keeps in process. The database store has neither array. */
interface MemoryEventRow {
  id: string;
  publisherId: string | null;
  title: string;
  status: string;
  startsAt: Date;
  venueName: string | null;
  location?: GeoPoint;
}

interface MemoryPublisherRow {
  id: string;
  name: string;
  verified: boolean;
  isTemporary: boolean;
}

interface MemoryLookupStore {
  events: MemoryEventRow[];
  publishers: MemoryPublisherRow[];
}

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Everything a tool needs besides the arguments the model sent. */
interface LookupContext {
  store: IngestStore;
  db?: Db;
  event: ScanInput;
  catalog: TagChoice[];
}

type ToolResult =
  | { error: string }
  | { events: NearbyEventHit[] }
  | { publishers: NearbyPublisherHit[] }
  | { tags: { id: string; name: string }[] };

/**
 * Tools offered on every `/api/chat` call. Ollama does not run them; the runner does.
 * Radius, time window, and row cap are described here and enforced in the lookups.
 */
function ollamaToolDefinitions(): object[] {
  const point = {
    lat: { type: 'number', description: 'Latitude in decimal degrees.' },
    lng: { type: 'number', description: 'Longitude in decimal degrees.' },
  };
  return [
    {
      type: 'function',
      function: {
        name: 'getNearbyEvents',
        description:
          'Events within 500 km of a point. Their start is from 1 day before the event being scanned through 1 days after. Cancelled and ended events are left out. Use this to see what is already listed nearby.',
        parameters: {
          type: 'object',
          properties: point,
          required: ['lat', 'lng'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getNearbyPublishers',
        description:
          'Publishers that have an event within 500 km in that same time window. A publisher has no point of its own; near means one of its events is near.',
        parameters: {
          type: 'object',
          properties: point,
          required: ['lat', 'lng'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getAvailableTags',
        description: 'The tag catalog. Call this before choosing tags. Only ids from this list may be used.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
}

/**
 * Scans a batch with tool calling. Same result shape as the plain Ollama runner:
 * the model may look up events, publishers, and tags, and code still picks the
 * publisher and the duplicate.
 */
export function createOllamaWithToolsPromptRunner(
  store: IngestStore,
  options: OllamaWithToolsRunnerOptions = {},
): PromptRunner {
  const config = options.config ?? {};
  const fetchImpl = options.fetch ?? fetch;
  const db = options.db;
  return {
    id: 'ollama-with-tools',
    /**
     * One event at a time. The tag catalog is loaded once. A repeated title,
     * place, and start reuses the first model answer instead of calling again.
     */
    async scan(batch) {
      const catalog = (await store.listTags()).map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
      }));
      const answers = new Map<string, LLMOutput | 'unavailable'>();
      const outcomes: ScanOutcome[] = [];
      for (const event of batch) {
        outcomes.push(await scanOneEvent(event, { store, db, event, catalog }, config, fetchImpl, answers));
      }
      return outcomes;
    },
  };
}

/**
 * Asks the model, then resolves the publisher and duplicate in code.
 * No organizer key means there is nothing to attach, so the model is not called.
 * A failed model call leaves the row for a later scan.
 */
async function scanOneEvent(
  event: ScanInput,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
  answers: Map<string, LLMOutput | 'unavailable'>,
): Promise<ScanOutcome> {
  if (event.organizer.keys.length === 0) {
    return { ok: false, eventId: event.eventId, reason: 'unavailable' };
  }

  const cacheKey = scanCacheKey(event);
  let llmoutput = answers.get(cacheKey);
  if (!llmoutput) {
    llmoutput = (await askModelWithLookups(buildScanPrompt(event), context, config, fetchImpl)) ?? 'unavailable';
    answers.set(cacheKey, llmoutput);
  }
  console.log('llmoutput', llmoutput);
  if (llmoutput === 'unavailable') {
    return { ok: false, eventId: event.eventId, reason: 'unavailable' };
  }

  const tags =
    event.existingTags.length > 0 ? event.existingTags : parseTagChoices(llmoutput, context.catalog);
  const publisher = await chooseExistingPublisher(event, context.store);
  const nearby = event.location
    ? await context.store.listDuplicateCandidates({
        location: event.location,
        startsAt: new Date(event.startsAt),
      })
    : [];

  return {
    ok: true,
    eventId: event.eventId,
    publisher,
    duplicate: strongestDuplicate(event, nearby),
    approved: true,
    tags,
    contentVerdict: llmoutput.contentVerdict,
    summary: llmoutput.summary,
    language: llmoutput.language,
    llmOutput: llmoutput.output,
  };
}

/**
 * Picks a publisher the same way as the plain runner. An alias or a nearby name
 * match wins; otherwise the scan will create a temporary publisher later.
 */
async function chooseExistingPublisher(event: ScanInput, store: IngestStore): Promise<ChosenPublisher> {
  const localSlugs = [...new Set([event.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
  const publishers = await store.listPublisherCandidates(event.source.id, event.organizer.keys, {
    ...(event.location ? { location: event.location } : {}),
    localSlugs,
  });
  const chosen = choosePublisher(event.source.id, event.organizer.keys, localSlugs, publishers);
  const match = publishers.find((row) => row.publisherId === chosen?.publisherId);
  if (match) {
    return {
      kind: 'existing',
      publisherId: match.publisherId,
      isTemporary: match.isTemporary,
      verified: match.verified,
      importNotificationPlan: match.importNotificationPlan,
    };
  }
  return {
    kind: 'temporary',
    name: event.organizer.name?.trim() || event.organizer.keys[0] || event.title,
    organizerKeys: event.organizer.keys,
  };
}

/**
 * Strongest lookalike among the store's 500 m / 30 minute candidates.
 * The same row and the same source worker are skipped. Ranking uses the domain
 * duplicate rules: shared id, then shared link, then a similar title.
 */
function strongestDuplicate(event: ScanInput, candidates: DuplicateCandidate[]): PossibleDuplicateMatch | null {
  const startsAt = new Date(event.startsAt);
  const incomingIds = [event.externalId];
  const incomingUrls = [event.sourceUrl, ...event.links];
  let best: { candidate: DuplicateCandidate; signal: DuplicateSignal } | null = null;
  for (const candidate of candidates) {
    const sameRowOrWorker = candidate.eventId === event.eventId || candidate.workerId === event.workerId;
    if (sameRowOrWorker) continue;
    const candidateUrls = [candidate.sourceUrl, ...candidate.links];
    const signal = duplicateSignal({
      distanceM: candidate.distanceM,
      withinWindow: withinDuplicateWindow(startsAt, candidate.startsAt),
      titleSimilarity: titleSimilarity(event.title, candidate.title),
      sharedEventLink: duplicateLinksMatch(incomingUrls, candidateUrls),
      sharedLink: anyLinksMatch(incomingUrls, candidateUrls),
      sameId: duplicateIdsMatch(incomingIds, [candidate.refId, ...candidate.externalIds]),
    });
    if (!signal) continue;
    if (
      !best ||
      preferDuplicate(
        { signal: best.signal, distanceM: best.candidate.distanceM },
        { signal, distanceM: candidate.distanceM },
      )
    ) {
      best = { candidate, signal };
    }
  }
  if (!best) return null;
  return {
    eventId: best.candidate.eventId,
    title: best.candidate.title,
    startsAt: best.candidate.startsAt.toISOString(),
    refId: best.candidate.refId,
    workerId: best.candidate.workerId,
    matchedOn: best.signal,
  };
}

/**
 * Tells the model which tools exist and which JSON object to return when it is done.
 * The event's own coordinates are included so it can pass them to the nearby tools.
 * The tag catalog is not inlined; the model calls getAvailableTags for that.
 */
function buildScanPrompt(event: ScanInput): string {
  const description = event.description?.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
  const place = event.location ? `lat ${event.location.lat}, lng ${event.location.lng}` : 'none';
  return [
    'You scan one imported event for spam, language, a short summary, and tags.',
    'Match the tags to the event as best as you can. Score the tags from 0 to 100 and include only scores over 90.',
    'Pick at most 5 tags.',
    'Dates and times in title and description are Stockholm local time, start and end times are in UTC.',
    'Try to find a duplicate event using the tools before you answer.',
    'You can look up existing data with tools before you answer:',
    'Try to find a existing publisher that matches the event organizer keys.',
    '- getNearbyEvents(lat, lng): events within 5 km, from 1 day before this event through 60 days after.',
    '- getNearbyPublishers(lat, lng): publishers that have published an event within 5 km of this event.',
    '- getAvailableTags(): the only tags you may use.',
    'Call a tool when you need that data. Do not invent event, publisher, or tag ids.',
    'When you are finished, return only JSON:',
    '{possiblePublisher: {publisherId: "<publisherId>"}, possibleDuplicates: {eventId: "<eventId>"}[], contentVerdict: "spam" | "harmful" | "safe", summary: "<summary>", language: "sv|en|etc", possibleTags: [{"id":"<id>","score":<score>}]}',
    'Score each tag from 0 to 100 and include only scores over 90.',
    'Write a short and brief summary in the language of the event. Do not include the city name. A venue is fine when it matters.',
    'Use the title, location, and description for the content verdict: "spam", "harmful", or "safe".',
    'Event:',
    `Title: ${event.title}`,
    `Starts: ${event.startsAt}`,
    `Ends: ${event.endsAt}`,
    `Point: ${place}`,
    ...(event.venue ? [`Location: ${event.venue}`] : []),
    ...(description ? [`Description: ${description}`] : []),
  ].join('\n');
}

/**
 * Posts the prompt, runs any tool calls, and posts again until the model returns
 * text or the round cap is hit. `format: json` is left off so tool calls are not
 * forced into a text body. The final text is parsed as the scan JSON.
 */
async function askModelWithLookups(
  prompt: string,
  context: LookupContext,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<LLMOutput | null> {
  if (ollamaDisabled()) return null;
  const messages: Record<string, unknown>[] = [{ role: 'user', content: prompt }];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const payload = await postOllamaChat(messages, config, fetchImpl);
    if (!payload) return null;
    const message = assistantMessage(payload);
    const calls = readToolCalls(message).slice(0, MAX_TOOL_CALLS_PER_ROUND);
    console.log('calls', calls);
    console.log('message', message);
    if (calls.length === 0) {
      if (!message || typeof message.content !== 'string') return null;
      return { ...parseScanJson(message.content), output: payload };
    }
    if (!message) return null;
    messages.push(message);
    for (const call of calls) {
      const result = await executeToolCall(call, context);
      messages.push({ role: 'tool', tool_name: call.name, content: JSON.stringify(result) });
    }
  }
  return null;
}

/**
 * One non-streaming chat request, including the tool list. A disabled server,
 * a bad base URL, a non-OK response, or a timeout returns null.
 */
async function postOllamaChat(
  messages: Record<string, unknown>[],
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<object | null> {
  let base: URL;
  let model: string;
  try {
    base = ollamaBaseUrl(config);
    model = ollamaModel(config);
  } catch {
    return null;
  }
  try {
    const response = await fetchImpl(new URL('/api/chat', base), {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0 },
        tools: ollamaToolDefinitions(),
        messages,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** The assistant message object Ollama returned, or null when the body has none. */
function assistantMessage(payload: object): Record<string, unknown> | null {
  if (!('message' in payload)) return null;
  const message = payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return message as Record<string, unknown>;
}

/**
 * Tool calls on an assistant message. Ollama puts them on `message.tool_calls`
 * with `function.name` and `function.arguments`. Arguments may be an object or
 * a JSON string. A call without a name is ignored.
 */
function readToolCalls(message: Record<string, unknown> | null): ParsedToolCall[] {
  if (!message || !Array.isArray(message.tool_calls)) return [];
  const calls: ParsedToolCall[] = [];
  for (const call of message.tool_calls) {
    if (!call || typeof call !== 'object') continue;
    const fn =
      'function' in call && call.function && typeof call.function === 'object' ? call.function : call;
    if (!fn || typeof fn !== 'object' || !('name' in fn) || typeof fn.name !== 'string') continue;
    const name = fn.name.trim();
    if (!name) continue;
    const args = 'arguments' in fn ? fn.arguments : undefined;
    calls.push({ name, arguments: readToolArguments(args) });
  }
  return calls;
}

/** Tool arguments as an object. A JSON string is parsed. Anything else is empty. */
function readToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

/**
 * Runs one tool the model named. Unknown names and bad coordinates come back as
 * `{ error }` so the model can correct itself. A lookup failure is the same shape
 * and does not abort the rest of the scan.
 */
async function executeToolCall(call: ParsedToolCall, context: LookupContext): Promise<ToolResult> {
  try {
    if (call.name === 'getAvailableTags') return lookupAvailableTags(context.catalog);
    if (call.name === 'getNearbyEvents') return lookupNearbyEvents(call.arguments, context);
    if (call.name === 'getNearbyPublishers') return lookupNearbyPublishers(call.arguments, context);
    return { error: `Unknown tool ${call.name}.` };
  } catch {
    return { error: 'Lookup failed.' };
  }
}

/**
 * Accepts lat and lng. `long` is accepted when `lng` is missing.
 * Out-of-range values are an error and do not query anything.
 */
function readLookupPoint(args: Record<string, unknown>): GeoPoint | { error: string } {
  const lat = finiteNumber(args.lat);
  const lng = finiteNumber(args.lng ?? args.long);
  if (lat == null || lat < -90 || lat > 90) return { error: 'lat must be a number from -90 to 90.' };
  if (lng == null || lng < -180 || lng > 180) return { error: 'lng must be a number from -180 to 180.' };
  return { lat, lng };
}

/**
 * A finite number, or null. Numeric strings are accepted because some models quote them.
 * A blank string is rejected so it is not read as zero.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * The time window the model cannot pass: one day before the scanned start
 * through 60 days after. An unreadable start makes the window empty.
 */
function nearbyWindow(startsAt: string): NearbyWindow {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) return { from: new Date(0), to: new Date(0) };
  return {
    from: new Date(start - NEARBY_DAYS_BEFORE * DAY_MS),
    to: new Date(start + NEARBY_DAYS_AFTER * DAY_MS),
  };
}

/**
 * Nearby events for the point the model sent. The scanned event is left out.
 * Memory stores are filtered in process. A database store uses `context.db`.
 */
async function lookupNearbyEvents(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = readLookupPoint(args);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const memory = memoryLookupStore(context.store);
  if (memory) return { events: nearbyEventsFromMemory(memory, point, window, context.event.eventId) };
  if (context.db) return { events: await nearbyEventsFromDatabase(context.db, point, window, context.event.eventId) };
  return { error: 'Nearby lookup is unavailable.' };
}

/**
 * Publishers with an event near the point, in the same window as nearby events.
 * Each publisher is returned once, from its closest event, capped at 20.
 */
async function lookupNearbyPublishers(
  args: Record<string, unknown>,
  context: LookupContext,
): Promise<ToolResult> {
  const point = readLookupPoint(args);
  if ('error' in point) return point;
  const window = nearbyWindow(context.event.startsAt);
  const memory = memoryLookupStore(context.store);
  if (memory) return { publishers: nearbyPublishersFromMemory(memory, point, window, context.event.eventId) };
  if (context.db) {
    return { publishers: await nearbyPublishersFromDatabase(context.db, point, window, context.event.eventId) };
  }
  return { error: 'Nearby lookup is unavailable.' };
}

/**
 * Tags loaded for this batch. The id field matches the `possibleTags` JSON the
 * model must return, so it can copy an id from this list.
 */
function lookupAvailableTags(catalog: TagChoice[]): ToolResult {
  return { tags: catalog.map((tag) => ({ id: tag.externalId, name: tag.name })) };
}

/**
 * Memory ingest stores keep `events` and `publishers` on the object.
 * The database store does not, so this returns null and the caller uses SQL.
 */
function memoryLookupStore(store: IngestStore): MemoryLookupStore | null {
  if (!('events' in store) || !('publishers' in store)) return null;
  const rows = store as IngestStore & { events: unknown; publishers: unknown };
  if (!Array.isArray(rows.events) || !Array.isArray(rows.publishers)) return null;
  return { events: rows.events as MemoryEventRow[], publishers: rows.publishers as MemoryPublisherRow[] };
}

/**
 * Distance in meters when the row is a live event inside the radius and window,
 * and it is not the event being scanned. Otherwise null.
 */
function nearbyDistance(
  event: MemoryEventRow,
  point: GeoPoint,
  window: NearbyWindow,
  excludeEventId: string,
): number | null {
  if (event.id === excludeEventId || !event.location) return null;
  if (event.status === 'cancelled' || event.status === 'ended') return null;
  const starts = event.startsAt.getTime();
  if (starts < window.from.getTime() || starts > window.to.getTime()) return null;
  const distanceM = distanceMeters(point, event.location);
  if (distanceM > NEARBY_RADIUS_M) return null;
  return Math.round(distanceM);
}

/** Up to 20 memory events, nearest first. */
function nearbyEventsFromMemory(
  store: MemoryLookupStore,
  point: GeoPoint,
  window: NearbyWindow,
  excludeEventId: string,
): NearbyEventHit[] {
  const hits: NearbyEventHit[] = [];
  for (const event of store.events) {
    const distanceM = nearbyDistance(event, point, window, excludeEventId);
    if (distanceM == null) continue;
    hits.push({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      venue: event.venueName,
      distanceM,
    });
  }
  return hits.sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
}

/** Up to 20 memory publishers, using each publisher's closest qualifying event. */
function nearbyPublishersFromMemory(
  store: MemoryLookupStore,
  point: GeoPoint,
  window: NearbyWindow,
  excludeEventId: string,
): NearbyPublisherHit[] {
  const publishers = new Map(store.publishers.map((publisher) => [publisher.id, publisher]));
  const closest = new Map<string, NearbyPublisherHit>();
  for (const event of store.events) {
    if (!event.publisherId) continue;
    const publisher = publishers.get(event.publisherId);
    const distanceM = nearbyDistance(event, point, window, excludeEventId);
    if (!publisher || distanceM == null) continue;
    const hit: NearbyPublisherHit = {
      id: publisher.id,
      name: publisher.name,
      verified: publisher.verified,
      temporary: publisher.isTemporary,
      nearestEventTitle: event.title,
      distanceM,
    };
    const current = closest.get(publisher.id);
    if (!current || hit.distanceM < current.distanceM) closest.set(publisher.id, hit);
  }
  return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
}

/**
 * Same filters as the memory lookup, in Postgres. `ST_DWithin` uses meters on geography.
 * The scanned event id is excluded. Results are nearest first, capped at 20.
 */
async function nearbyEventsFromDatabase(
  db: Db,
  point: GeoPoint,
  window: NearbyWindow,
  excludeEventId: string,
): Promise<NearbyEventHit[]> {
  const { events } = schema;
  const ewkt = pointEwkt(point);
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      venue: events.venueName,
      distanceM: sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`,
    })
    .from(events)
    .where(
      and(
        isNotNull(events.location),
        sql`ST_DWithin(${events.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
        gte(events.startsAt, window.from),
        lte(events.startsAt, window.to),
        notInArray(events.status, ['cancelled', 'ended']),
        ne(events.id, excludeEventId),
      ),
    )
    .orderBy(sql`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`)
    .limit(NEARBY_RESULT_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    venue: row.venue,
    distanceM: Math.round(Number(row.distanceM)),
  }));
}

/**
 * One row per publisher: the closest qualifying event. Postgres `DISTINCT ON`
 * keeps that row because the distance sort follows the publisher id.
 * The 20 nearest publishers are chosen after that, so a busy point cannot
 * hide a publisher behind other events.
 */
async function nearbyPublishersFromDatabase(
  db: Db,
  point: GeoPoint,
  window: NearbyWindow,
  excludeEventId: string,
): Promise<NearbyPublisherHit[]> {
  const { events, publishers } = schema;
  const ewkt = pointEwkt(point);
  const distance = sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`;
  const rows = await db
    .selectDistinctOn([publishers.id], {
      id: publishers.id,
      name: publishers.name,
      verified: publishers.verified,
      temporary: publishers.isTemporary,
      nearestEventTitle: events.title,
      distanceM: distance,
    })
    .from(events)
    .innerJoin(publishers, eq(publishers.id, events.publisherId))
    .where(
      and(
        isNotNull(events.location),
        isNotNull(events.publisherId),
        sql`ST_DWithin(${events.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
        gte(events.startsAt, window.from),
        lte(events.startsAt, window.to),
        notInArray(events.status, ['cancelled', 'ended']),
        ne(events.id, excludeEventId),
      ),
    )
    .orderBy(publishers.id, distance);
  const closest = new Map<string, NearbyPublisherHit>();
  for (const row of rows) {
    const hit: NearbyPublisherHit = {
      id: row.id,
      name: row.name,
      verified: row.verified,
      temporary: row.temporary,
      nearestEventTitle: row.nearestEventTitle,
      distanceM: Math.round(Number(row.distanceM)),
    };
    const current = closest.get(hit.id);
    if (!current || hit.distanceM < current.distanceM) closest.set(hit.id, hit);
  }
  return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
}

/**
 * Pulls the scan JSON out of the model text. A missing or broken object becomes
 * a safe empty result, matching the plain runner. A parsed object with no verdict
 * stays `unknown`.
 */
function parseScanJson(content: string): LLMScanResult {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return emptyScan('safe');
  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyScan('safe');
    const record = parsed as Record<string, unknown>;
    return {
      contentVerdict: readContentVerdict(record.contentVerdict, 'unknown'),
      possibleTags: tagScores(record.possibleTags),
      summary: typeof record.summary === 'string' ? record.summary : '',
      language: typeof record.language === 'string' ? record.language : '',
    };
  } catch {
    return emptyScan('safe');
  }
}

/** Empty scan used when the model text has no JSON object. */
function emptyScan(contentVerdict: LLMScanResult['contentVerdict']): LLMScanResult {
  return { contentVerdict, possibleTags: [], summary: '', language: '' };
}

/** Keeps only the three verdicts the scan stores. Anything else uses `fallback`. */
function readContentVerdict(
  value: unknown,
  fallback: LLMScanResult['contentVerdict'],
): LLMScanResult['contentVerdict'] {
  if (value === 'spam' || value === 'harmful' || value === 'safe' || value === 'unknown') return value;
  return fallback;
}

/** Tag scores the catalog matcher understands. Rows that are not objects are dropped. */
function tagScores(value: unknown): LLMScanResult['possibleTags'] {
  if (!Array.isArray(value)) return [];
  const scores: LLMScanResult['possibleTags'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item ? item.id : undefined;
    const score = 'score' in item ? item.score : undefined;
    if ((typeof id !== 'string' && typeof id !== 'number') || typeof score !== 'number') continue;
    scores.push({ id: String(id), score });
  }
  return scores;
}

/**
 * Cache key for one model answer. Place and start are included because the tools
 * depend on them. The event id is not, so two copies of the same listing share a call.
 */
function scanCacheKey(event: TagMatchInput & Pick<ScanInput, 'startsAt' | 'location'>): string {
  const point = event.location ? `${event.location.lat},${event.location.lng}` : '';
  return [event.title, event.description ?? '', event.venue ?? '', event.startsAt, point].join('\n');
}

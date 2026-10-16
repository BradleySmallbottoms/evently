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
import {
  ollamaBaseUrl,
  ollamaDisabled,
  ollamaModel,
  parseTagChoices,
  tagMatchPrompt,
  titleSimilarity,
  type TagChoice,
} from '@local-events/ingest';
import { LOCAL_ORGANIZER_SLUGS } from '../sources';
import type { DuplicateCandidate, IngestStore } from '../store';
import type {
  ChosenPublisher,
  PossibleDuplicateMatch,
  PromptRunner,
  ScanInput,
  ScanOutcome,
} from './types';

const TAG_TIMEOUT_MS = 90_000;

interface ModelRequest {
  prompt: string;
  format: 'json';
  temperature: number;
  timeoutMs: number;
}

type ModelResponse =
  | { ok: true; content: string }
  | { ok: false; reason: 'disabled' | 'unavailable' };

export interface OllamaPromptRunnerOptions {
  config?: Record<string, unknown>;
  /** Replaces the loopback chat call. Tests use this to skip a running model. */
  complete?: (request: ModelRequest) => Promise<ModelResponse>;
}

function messageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return '';
  const message = payload.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

function ollamaComplete(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): (request: ModelRequest) => Promise<ModelResponse> {
  return async (request) => {
    if (ollamaDisabled()) return { ok: false, reason: 'disabled' };
    let base: URL;
    let model: string;
    try {
      base = ollamaBaseUrl(config);
      model = ollamaModel(config);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    try {
      const response = await fetchImpl(new URL('/api/chat', base), {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: request.format,
          options: { temperature: request.temperature },
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      if (!response.ok) return { ok: false, reason: 'unavailable' };
      return { ok: true, content: messageContent(await response.json()) };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  };
}

function temporaryPublisher(input: ScanInput): ChosenPublisher {
  const name = input.organizer.name?.trim() || input.organizer.keys[0] || input.title;
  return { kind: 'temporary', name, organizerKeys: input.organizer.keys };
}

async function chooseExistingPublisher(store: IngestStore, input: ScanInput): Promise<ChosenPublisher> {
  const localSlugs = [...new Set([input.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
  const candidates = await store.listPublisherCandidates(input.source.id, input.organizer.keys, {
    ...(input.location ? { location: input.location } : {}),
    localSlugs,
  });
  const chosen = choosePublisher(input.source.id, input.organizer.keys, localSlugs, candidates);
  const match = candidates.find((row) => row.publisherId === chosen?.publisherId);
  if (!match) return temporaryPublisher(input);
  return {
    kind: 'existing',
    publisherId: match.publisherId,
    isTemporary: match.isTemporary,
    verified: match.verified,
    importNotificationPlan: match.importNotificationPlan,
  };
}

function matchPossibleDuplicate(
  input: ScanInput,
  candidates: DuplicateCandidate[],
): PossibleDuplicateMatch | null {
  if (!input.location) return null;
  const startsAt = new Date(input.startsAt);
  const incomingIds = [input.externalId];
  const incomingUrls = [input.sourceUrl, ...input.links];
  let best: { candidate: DuplicateCandidate; signal: DuplicateSignal } | null = null;
  for (const candidate of candidates) {
    const sameRow =
      candidate.eventId === input.eventId ||
      (candidate.workerId === input.workerId &&
        (candidate.refId === input.externalId || candidate.externalIds.includes(input.externalId)));
    if (sameRow) continue;
    const candidateUrls = [candidate.sourceUrl, ...candidate.links];
    const signal = duplicateSignal({
      distanceM: candidate.distanceM,
      withinWindow: withinDuplicateWindow(startsAt, candidate.startsAt),
      titleSimilarity: titleSimilarity(input.title, candidate.title),
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

async function findDuplicate(store: IngestStore, input: ScanInput): Promise<PossibleDuplicateMatch | null> {
  if (!input.location) return null;
  const candidates = await store.duplicateCandidates({
    location: input.location,
    startsAt: new Date(input.startsAt),
  });
  return matchPossibleDuplicate(input, candidates);
}

function tagCacheKey(input: ScanInput): string {
  return [input.title, input.description ?? '', input.venue ?? ''].join('\n');
}

async function tagsFor(
  input: ScanInput,
  catalog: TagChoice[],
  complete: (request: ModelRequest) => Promise<ModelResponse>,
  cache: Map<string, TagChoice[] | 'unavailable'>,
): Promise<TagChoice[] | 'unavailable'> {
  if (input.existingTags.length > 0) return input.existingTags;
  if (catalog.length === 0) return [];
  const key = tagCacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;
  const response = await complete({
    prompt: tagMatchPrompt(
      {
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.venue ? { venue: input.venue } : {}),
      },
      catalog,
    ),
    format: 'json',
    temperature: 0,
    timeoutMs: TAG_TIMEOUT_MS,
  });
  if (!response.ok) {
    cache.set(key, 'unavailable');
    return 'unavailable';
  }
  const tags = parseTagChoices(response.content, catalog);
  cache.set(key, tags);
  return tags;
}

/**
 * Ollama walks the batch one event at a time. It loads publisher and duplicate
 * candidates itself, then asks the local model for tags when the event has none.
 */
export function createOllamaPromptRunner(
  store: IngestStore,
  options: OllamaPromptRunnerOptions = {},
): PromptRunner {
  const complete = options.complete ?? ollamaComplete(options.config ?? {}, fetch);
  return {
    id: 'ollama',
    async scan(batch) {
      const catalog = (await store.listTags()).map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
      }));
      const tagsByKey = new Map<string, TagChoice[] | 'unavailable'>();
      const outcomes: ScanOutcome[] = [];
      for (const input of batch) {
        if (input.organizer.keys.length === 0) {
          outcomes.push({ ok: false, eventId: input.eventId, reason: 'unavailable' });
          continue;
        }
        const tags = await tagsFor(input, catalog, complete, tagsByKey);
        if (tags === 'unavailable') {
          outcomes.push({ ok: false, eventId: input.eventId, reason: 'unavailable' });
          continue;
        }
        outcomes.push({
          ok: true,
          eventId: input.eventId,
          publisher: await chooseExistingPublisher(store, input),
          duplicate: await findDuplicate(store, input),
          approved: true,
          tags,
        });
      }
      return outcomes;
    },
  };
}

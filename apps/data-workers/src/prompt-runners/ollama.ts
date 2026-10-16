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
  titleSimilarity,
  type TagChoice,
  type TagMatchInput,
} from '@local-events/ingest';
import { LOCAL_ORGANIZER_SLUGS } from '../sources';
import type { DuplicateCandidate, IngestStore } from '../store';
import type { ChosenPublisher, PossibleDuplicateMatch, PromptRunner, ScanInput, ScanOutcome } from './types';

const TAG_TIMEOUT_MS = 90_000;

export interface OllamaPromptRunnerOptions {
  config?: Record<string, unknown>;
  /** Tests pass this so a scan does not call a running Ollama. */
  fetch?: typeof fetch;
}

function messageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return '';
  const message = payload.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

async function askOllama(
  prompt: string,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  console.log('askOllama', prompt);
  if (ollamaDisabled()) return null;
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
        format: 'json',
        options: { temperature: 0 },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(TAG_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const ollameResponse = await response.json()
    console.log('ollameResponse', ollameResponse);
    return messageContent(ollameResponse);
  } catch {
    return null;
  }
}

function bestDuplicate(event: ScanInput, candidates: DuplicateCandidate[]): PossibleDuplicateMatch | null {
  const startsAt = new Date(event.startsAt);
  const incomingIds = [event.externalId];
  const incomingUrls = [event.sourceUrl, ...event.links];
  let best: { candidate: DuplicateCandidate; signal: DuplicateSignal } | null = null;
  for (const candidate of candidates) {
    const sameRowOrWorkerId = candidate.eventId === event.eventId || candidate.workerId === event.workerId;
    if (sameRowOrWorkerId) continue;
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
  console.log('Best duplicate', best);
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
 * Walks the batch one event at a time. Each event loads its publisher and
 * duplicate candidates, then asks Ollama for tags when the event has none.
 */
export function createOllamaPromptRunner(
  store: IngestStore,
  options: OllamaPromptRunnerOptions = {},
): PromptRunner {
  const config = options.config ?? {};
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'ollama',
    async scan(batch) {
      const catalog = (await store.listTags()).map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
      }));
      const tagsByText = new Map<string, TagChoice[] | 'unavailable'>();
      const outcomes: ScanOutcome[] = [];

      for (const event of batch) {
        if (event.organizer.keys.length === 0) {
          outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
          continue;
        }

        let tags: TagChoice[] | 'unavailable' = event.existingTags;
        if (event.existingTags.length === 0 && catalog.length > 0) {
          const textKey = [event.title, event.description ?? '', event.venue ?? ''].join('\n');
          const cached = tagsByText.get(textKey);
          if (cached) {
            tags = cached;
          } else {
            const prompt = buildPrompt(
              {
                title: event.title,
                ...(event.description ? { description: event.description } : {}),
                ...(event.venue ? { venue: event.venue } : {}),
              },
              catalog,
            );
            const content = await askOllama(prompt, config, fetchImpl);
            if (content == null) {
              tagsByText.set(textKey, 'unavailable');
              outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
              continue;
            }
            tags = parseTagChoices(content, catalog);
            tagsByText.set(textKey, tags);
          }
          if (tags === 'unavailable') {
            outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
            continue;
          }
        }

        const localSlugs = [...new Set([event.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
        const publishers = await store.listPublisherCandidates(event.source.id, event.organizer.keys, {
          ...(event.location ? { location: event.location } : {}),
          localSlugs,
        });
        const chosen = choosePublisher(event.source.id, event.organizer.keys, localSlugs, publishers);
        const match = publishers.find((row) => row.publisherId === chosen?.publisherId);
        const publisher: ChosenPublisher = match
          ? {
              kind: 'existing',
              publisherId: match.publisherId,
              isTemporary: match.isTemporary,
              verified: match.verified,
              importNotificationPlan: match.importNotificationPlan,
            }
          : {
              kind: 'temporary',
              name: event.organizer.name?.trim() || event.organizer.keys[0] || event.title,
              organizerKeys: event.organizer.keys,
            };

        const nearby = event.location
          ? await store.listDuplicateCandidates({
              location: event.location,
              startsAt: new Date(event.startsAt),
            })
          : [];

        outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });

        // outcomes.push({
        //   ok: true,
        //   eventId: event.eventId,
        //   publisher,
        //   duplicate: bestDuplicate(event, nearby),
        //   approved: true,
        //   tags,
        // });
      }

      return outcomes;
    },
  };
}

const DESCRIPTION_LIMIT = 1_200;

function buildPrompt(event: TagMatchInput, catalog: TagChoice[]): string {
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
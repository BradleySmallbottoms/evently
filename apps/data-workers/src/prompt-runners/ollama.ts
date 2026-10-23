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
import { scanEventLines } from '../scan-event-text';
import {
  ollamaBaseUrl,
  ollamaDisabled,
  ollamaModel,
  parseTagChoices,
  readScanInstructions,
  readScanRange,
  titleSimilarity,
  type LLMOutput,
  type LLMScanResult,
  type TagChoice,
  type TagMatchInput,
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

export interface OllamaPromptRunnerOptions {
  config?: Record<string, unknown>;
  /** Tests pass this so a scan does not call a running Ollama. */
  fetch?: typeof fetch;
}

function messageContent(payload: unknown): (LLMScanResult & LLMOutput) | null {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) return null;
  const message = payload.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return null;
  return typeof message.content === 'string'
    ? { ...parseResponse(message.content), output: payload as object }
    : null;
}

function parseResponse(content: string): LLMScanResult {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return emptyScan();
  let parsed: LLMScanResult;
  try {
    parsed = JSON.parse(content.slice(start, end + 1)) as LLMScanResult;
  } catch {
    return emptyScan();
  }
  if (!parsed || typeof parsed !== 'object') return emptyScan();
  return {
    ...parsed,
    summary: parsed.summary ?? '',
    language: parsed.language ?? '',
    instructions: readScanInstructions(parsed.instructions),
    possibleVenueNames: Array.isArray(parsed.possibleVenueNames) ? parsed.possibleVenueNames : [],
    ...(readScanRange(parsed) ?? { startsAt: null, endsAt: null }),
  };
}

function emptyScan(): LLMScanResult {
  return {
    contentVerdict: 'safe',
    possibleTags: [],
    possiblePublishers: [],
    possibleDuplicates: [],
    summary: '',
    language: '',
    instructions: [],
    possibleVenueNames: [],
    startsAt: null,
    endsAt: null,
  };
}

async function askOllama(
  prompt: string,
  config: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<LLMOutput | null> {
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
    const ollameResponse = await response.json();
    return messageContent(ollameResponse);
  } catch {
    return null;
  }
}

function bestDuplicate(
  event: ScanInput,
  candidates: DuplicateCandidate[],
): PossibleDuplicateMatch | null {
  const startsAt = new Date(event.startsAt);
  const incomingIds = [event.externalId];
  const incomingUrls = [event.sourceUrl, ...event.links];
  let best: { candidate: DuplicateCandidate; signal: DuplicateSignal } | null = null;
  for (const candidate of candidates) {
    const sameRow =
      candidate.eventId === event.eventId ||
      (candidate.workerId === event.workerId &&
        (candidate.refId === event.externalId || candidate.externalIds.includes(event.externalId)));
    if (sameRow) continue;
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
        let llmoutput: LLMOutput | null = null;
        if (event.organizer.keys.length === 0) {
          outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
          continue;
        }

        let tags: TagChoice[] | 'unavailable' = event.existingTags;
        if (catalog.length > 0) {
          const textKey = [
            event.title,
            event.description ?? '',
            event.tip?.text ?? '',
            event.tip?.categoryHint ?? '',
            event.venue ?? '',
          ].join('\n');
          const cached = tagsByText.get(textKey);
          if (cached) {
            tags = cached;
          } else {
            const prompt = buildPrompt(event, catalog);
            llmoutput = await askOllama(prompt, config, fetchImpl);
            if (llmoutput == null) {
              tagsByText.set(textKey, 'unavailable');
              outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
              continue;
            }
            tags = parseTagChoices(llmoutput as LLMScanResult, catalog);
            tagsByText.set(textKey, tags);
          }
          if (tags === 'unavailable') {
            outcomes.push({ ok: false, eventId: event.eventId, reason: 'unavailable' });
            continue;
          }
        }

        const localSlugs = [...new Set([event.source.slug, ...LOCAL_ORGANIZER_SLUGS])];
        const publishers = await store.listPublisherCandidates(
          event.source.id,
          event.organizer.keys,
          {
            ...(event.location ? { location: event.location } : {}),
            localSlugs,
          },
        );
        const chosen = choosePublisher(
          event.source.id,
          event.organizer.keys,
          localSlugs,
          publishers,
        );
        const match = publishers.find((row) => row.publisherId === chosen?.publisherId);
        const publisher: ChosenPublisher = match
          ? {
              kind: 'existing',
              publisherId: match.publisherId,
              isTemporary: match.isTemporary,
              status: match.status,
              importNotificationPlan: match.importNotificationPlan,
            }
          : {
              kind: 'temporary',
              name: event.organizer.name?.trim() || event.organizer.keys[0] || event.title,
              organizerKeys: event.organizer.keys,
            };

        const startsAt = new Date(event.startsAt);
        const nearby =
          event.location && !Number.isNaN(startsAt.getTime())
            ? await store.listDuplicateCandidates({
                location: event.location,
                startsAt,
              })
            : [];

        outcomes.push({
          ok: true,
          eventId: event.eventId,
          publisher,
          duplicate: bestDuplicate(event, nearby),
          approved: true,
          tags,
          contentVerdict: llmoutput?.contentVerdict ?? 'unknown',
          summary: llmoutput?.summary ?? '',
          language: llmoutput?.language ?? '',
          instructions: llmoutput?.instructions ?? [],
          startsAt: llmoutput?.startsAt ?? null,
          endsAt: llmoutput?.endsAt ?? null,
          llmOutput: llmoutput?.output ?? {},
        });
      }

      return outcomes;
    },
    async lookupPublisher() {
      return { ok: false, reason: 'unavailable' };
    },
  };
}

function buildPrompt(
  event: TagMatchInput & { tip?: { text?: string; categoryHint?: string } },
  catalog: TagChoice[],
): string {
  const lines = catalog.map((tag) => `${tag.externalId} | ${tag.name}`);
  return [
    'You are a helpful assistant that helps to tag and scan events from spam and harmful content using tags from a catalog.',
    'You will also help to determine language used in descriptions and titles of events.',
    'Foreach event I also want you to draft a short brief summary of the event in the language of the event, do not include name of the city but you can use location/venue if it is relevant.',
    'For each tag, evaluate how well it fits the event from 0 to 100 and include every tag you choose.',
    'Use the title, location, and description to determine the content verdict. When the event has a Tip chat section, use those chat lines as well.',
    'The content verdict can be "spam", "harmful", or "safe".',
    'Only return JSON: {contentVerdict: "spam" | "harmful" | "safe", summary: "<summary>", language: "sv|en|etc", possibleTags: [{"id":"<id>","score":<score>}]}',
    'Available tags:',
    ...lines,
    'Event Data:',
    `Title: ${event.title}`,
    ...(event.venue ? [`Location: ${event.venue}`] : []),
    ...scanEventLines(event),
  ].join('\n');
}

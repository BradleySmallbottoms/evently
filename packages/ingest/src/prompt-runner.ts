import {
  anyLinksMatch,
  choosePublisher,
  duplicateIdsMatch,
  duplicateLinksMatch,
  duplicateSignal,
  preferDuplicate,
  withinDuplicateWindow,
  type DuplicateSignal,
  type MarketingPushPlanId,
  type SourceTrust,
} from '@local-events/domain';
import type { ModelClient } from './model-client';
import { parseTagChoices, tagMatchPrompt, type TagChoice } from './tag-match';
import { titleSimilarity } from './dedupe';

export interface ScanPublisherCandidate {
  publisherId: string;
  sourceId: string | null;
  key: string;
  verified: boolean;
  createdAt: number;
  near: boolean;
  isTemporary: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
}

export interface ScanDuplicateCandidate {
  eventId: string;
  title: string;
  startsAt: Date;
  sourceUrl: string | null;
  links: string[];
  refId: string | null;
  workerId: string | null;
  externalIds: string[];
  distanceM: number;
}

export interface PossibleDuplicateMatch {
  eventId: string;
  title: string;
  startsAt: string;
  refId: string | null;
  workerId: string | null;
  matchedOn: DuplicateSignal;
}

export interface ScanInput {
  eventId: string;
  title: string;
  description?: string;
  venue?: string;
  startsAt: string;
  location?: { lat: number; lng: number };
  sourceUrl?: string;
  links: string[];
  externalId: string;
  workerId: string;
  existingTags: TagChoice[];
  source: { id: string; trust: SourceTrust };
  organizer: { keys: string[]; name?: string };
  localSlugs: string[];
  publisherCandidates: ScanPublisherCandidate[];
  duplicateCandidates: ScanDuplicateCandidate[];
  tagCatalog: TagChoice[];
}

export type ChosenPublisher =
  | {
      kind: 'existing';
      publisherId: string;
      isTemporary: boolean;
      verified: boolean;
      importNotificationPlan: MarketingPushPlanId | null;
    }
  | { kind: 'temporary'; name: string; organizerKeys: string[] };

export type ScanOutcome =
  | {
      ok: true;
      eventId: string;
      publisher: ChosenPublisher;
      duplicate: PossibleDuplicateMatch | null;
      /** Content scan. This step always approves. A later prompt can return false. */
      approved: boolean;
      tags: TagChoice[];
    }
  | { ok: false; eventId: string; reason: 'unavailable' };

/**
 * Scans a batch. The Ollama implementation walks the batch one event at a time.
 * A later RunPod implementation can send the same batch in one job.
 */
export interface PromptRunner {
  readonly id: string;
  scan(batch: ScanInput[]): Promise<ScanOutcome[]>;
}

const TAG_TIMEOUT_MS = 90_000;

function temporaryPublisher(input: ScanInput): ChosenPublisher {
  const name = input.organizer.name?.trim() || input.organizer.keys[0] || input.title;
  return { kind: 'temporary', name, organizerKeys: input.organizer.keys };
}

function chooseExistingPublisher(input: ScanInput): ChosenPublisher {
  const chosen = choosePublisher(
    input.source.id,
    input.organizer.keys,
    input.localSlugs,
    input.publisherCandidates,
  );
  const match = input.publisherCandidates.find((row) => row.publisherId === chosen?.publisherId);
  if (!match) return temporaryPublisher(input);
  return {
    kind: 'existing',
    publisherId: match.publisherId,
    isTemporary: match.isTemporary,
    verified: match.verified,
    importNotificationPlan: match.importNotificationPlan,
  };
}

/** Same rules as the import duplicate check: distance, 30 minutes, then id, link, or title. */
export function matchPossibleDuplicate(input: ScanInput): PossibleDuplicateMatch | null {
  if (!input.location) return null;
  const startsAt = new Date(input.startsAt);
  const incomingIds = [input.externalId];
  const incomingUrls = [input.sourceUrl, ...input.links];
  let best: { candidate: ScanDuplicateCandidate; signal: DuplicateSignal } | null = null;
  for (const candidate of input.duplicateCandidates) {
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

function tagCacheKey(input: ScanInput): string {
  return [input.title, input.description ?? '', input.venue ?? ''].join('\n');
}

/**
 * Publisher match, duplicate check, a content decision, and tag lookup.
 * Tag lookup calls the model once per distinct title in the batch.
 * Events that already have tags skip the model.
 * The content decision approves every event until a later prompt can reject one.
 */
export function createRulesPromptRunner(model: ModelClient): PromptRunner {
  return {
    id: model.id,
    async scan(batch) {
      const tagsByKey = new Map<string, TagChoice[] | 'unavailable'>();
      const outcomes: ScanOutcome[] = [];
      for (const input of batch) {
        if (input.organizer.keys.length === 0) {
          outcomes.push({ ok: false, eventId: input.eventId, reason: 'unavailable' });
          continue;
        }
        const tags = await tagsFor(input, model, tagsByKey);
        if (tags === 'unavailable') {
          outcomes.push({ ok: false, eventId: input.eventId, reason: 'unavailable' });
          continue;
        }
        outcomes.push({
          ok: true,
          eventId: input.eventId,
          publisher: chooseExistingPublisher(input),
          duplicate: matchPossibleDuplicate(input),
          approved: true,
          tags,
        });
      }
      return outcomes;
    },
  };
}

async function tagsFor(
  input: ScanInput,
  model: ModelClient,
  cache: Map<string, TagChoice[] | 'unavailable'>,
): Promise<TagChoice[] | 'unavailable'> {
  if (input.existingTags.length > 0) return input.existingTags;
  if (input.tagCatalog.length === 0) return [];
  const key = tagCacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;
  const response = await model.complete({
    prompt: tagMatchPrompt(
      {
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(input.venue ? { venue: input.venue } : {}),
      },
      input.tagCatalog,
    ),
    format: 'json',
    temperature: 0,
    timeoutMs: TAG_TIMEOUT_MS,
  });
  if (!response.ok) {
    cache.set(key, 'unavailable');
    return 'unavailable';
  }
  const tags = parseTagChoices(response.content, input.tagCatalog);
  cache.set(key, tags);
  return tags;
}

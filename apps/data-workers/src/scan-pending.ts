import {
  importPlanToSchedule,
  shouldEnqueueNotifications,
  statusAfterImportScan,
} from '@local-events/domain';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import type { PromptRunner, ScanInput, ScanOutcome } from './prompt-runners';
import type { IngestStore, PendingScanRow, PublisherLink } from './store';

export const SCAN_BATCH_LIMIT = 5;
/** Long enough for one Ollama call per event in the batch. */
export const SCAN_LEASE_MS = 10 * 60 * 1000;

export interface ScanSummary {
  claimed: number;
  published: number;
  review: number;
  unavailable: number;
  skipped: number;
}

const EVENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads `--event` / `--limit` (or `EVENT_ID` / `SCAN_LIMIT`) for a manual scan run. */
export function parseScanSelection(input: {
  eventId?: string;
  limit?: string;
}): { ok: true; eventId?: string; limit?: number } | { ok: false; message: string } {
  if (input.eventId != null) {
    const eventId = input.eventId.trim();
    if (!EVENT_ID.test(eventId)) return { ok: false, message: '--event must be an event id' };
    const limited = parseLimit(input.limit);
    if (!limited.ok) return limited;
    return { ok: true, eventId, ...(limited.limit != null ? { limit: limited.limit } : {}) };
  }
  const limited = parseLimit(input.limit);
  if (!limited.ok) return limited;
  return { ok: true, ...(limited.limit != null ? { limit: limited.limit } : {}) };
}

function parseLimit(
  limit: string | undefined,
): { ok: true; limit?: number } | { ok: false; message: string } {
  const rawLimit = limit?.trim();
  if (rawLimit == null || rawLimit === '') return { ok: true };
  if (!/^[1-9]\d{0,2}$/.test(rawLimit)) {
    return { ok: false, message: '--limit must be a whole number from 1 to 999' };
  }
  return { ok: true, limit: Number(rawLimit) };
}

export async function scanPendingEvents(
  store: IngestStore,
  runner: PromptRunner,
  enqueue: DomainEventSink = noopDomainEvents,
  options: { limit?: number; leaseMs?: number; eventId?: string } = {},
): Promise<ScanSummary> {
  const limit = options.limit ?? SCAN_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? SCAN_LEASE_MS;
  const claimed = await store.claimPendingScans(limit, leaseMs, options.eventId);
  const summary: ScanSummary = {
    claimed: claimed.length,
    published: 0,
    review: 0,
    unavailable: 0,
    skipped: 0,
  };
  if (claimed.length === 0) return summary;
  const batch: ScanInput[] = [];
  const rows = new Map<string, PendingScanRow>();
  for (const row of claimed) {
    const input = scanInputFor(row);
    rows.set(row.eventId, row);
    batch.push(input);
  }
  const outcomes = batch.length > 0 ? await runner.scan(batch) : [];
  const temporaries = new Map<string, PublisherLink>();
  for (const outcome of outcomes) {
    const row = rows.get(outcome.eventId);
    if (!row) continue;
    if (!outcome.ok) {
      await store.releaseScanClaim(row.eventId, row.claimedUntil);
      summary.unavailable += 1;
      continue;
    }
    const applied = await applyOutcome(store, row, outcome, enqueue, temporaries);
    if (applied === 'published') summary.published += 1;
    else if (applied === 'review') summary.review += 1;
    else summary.skipped += 1;
  }
  return summary;
}

function scanInputFor(row: PendingScanRow): ScanInput {
  const organizerKeys = row.meta.import?.organizerKeys ?? [];
  return {
    eventId: row.eventId,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.venueName ? { venue: row.venueName } : {}),
    startsAt: row.startsAt.toISOString(),
    ...(row.location ? { location: row.location } : {}),
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    links: row.links,
    externalId: row.externalId,
    workerId: row.workerId,
    existingTags: row.tags,
    source: { id: row.sourceId, slug: row.sourceSlug, trust: row.sourceTrust },
    organizer: {
      keys: organizerKeys,
      ...(row.meta.import?.organizerName ? { name: row.meta.import.organizerName } : {}),
    },
  };
}

async function applyOutcome(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  enqueue: DomainEventSink,
  temporaries: Map<string, PublisherLink>,
): Promise<'published' | 'review' | 'skipped'> {
  const publisher = await publisherFor(store, row, outcome, temporaries);
  const status = statusAfterImportScan({
    approved: outcome.approved,
    publisherVerified: publisher.verified,
    publisherIsTemporary: publisher.isTemporary,
    sourceTrust: row.sourceTrust,
    possibleDuplicate: outcome.duplicate !== null,
  });
  const tagIds =
    row.tagIds.length > 0
      ? row.tagIds
      : await store.tagIdsForExternalIds(outcome.tags.map((tag) => tag.externalId));
  const meta = {
    ...row.meta,
    ...(outcome.duplicate ? { possibleDuplicate: outcome.duplicate } : {}),
  };
  const saved = await store.finishImportedScan({
    eventId: row.eventId,
    publisherId: publisher.publisherId,
    status,
    meta,
    tagIds,
    llmOutput: outcome.llmOutput ?? {},
    contentVerdict: outcome.contentVerdict,
    claimedUntil: row.claimedUntil,
  });
  if (!saved) return 'skipped';
  if (store.scheduleImportNotifications) {
    const planId = importPlanToSchedule({
      publisherVerified: publisher.verified,
      planId: publisher.importNotificationPlan,
    });
    if (planId) {
      await store.scheduleImportNotifications({
        eventId: row.eventId,
        eventTitle: row.title,
        startsAt: row.startsAt,
        planId,
        status,
      });
    }
  }
  if (shouldEnqueueNotifications(status)) {
    await emitDomainEvent(enqueue, { type: 'event.published', eventId: row.eventId });
  }
  return status === 'published' ? 'published' : 'review';
}

async function publisherFor(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  temporaries: Map<string, PublisherLink>,
): Promise<PublisherLink> {
  if (outcome.publisher.kind === 'temporary') {
    const keys = outcome.publisher.organizerKeys;
    for (const [stored, publisher] of temporaries) {
      const storedKeys = stored.split('\n');
      if (!keys.some((key) => storedKeys.includes(key))) continue;
      await store.rememberOrganizerKeys(row.sourceId, publisher.publisherId, keys);
      temporaries.delete(stored);
      temporaries.set([...new Set([...storedKeys, ...keys])].join('\n'), publisher);
      return publisher;
    }
    const created = await store.createTemporaryPublisher({
      sourceId: row.sourceId,
      organizerKeys: keys,
      name: outcome.publisher.name,
    });
    temporaries.set(keys.join('\n'), created);
    return created;
  }
  await store.rememberOrganizerKeys(
    row.sourceId,
    outcome.publisher.publisherId,
    row.meta.import?.organizerKeys ?? [],
  );
  return {
    publisherId: outcome.publisher.publisherId,
    isTemporary: outcome.publisher.isTemporary,
    verified: outcome.publisher.verified,
    importNotificationPlan: outcome.publisher.importNotificationPlan,
  };
}

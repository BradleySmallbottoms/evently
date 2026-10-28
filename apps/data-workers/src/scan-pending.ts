import { randomUUID } from 'node:crypto';
import { readScanInstructions } from '@local-events/ingest';
import {
  choosePossibleOccasionGroupId,
  importedVenueName,
  importPlanToSchedule,
  occasionsToAdd,
  OCCASION_GROUP_MIN_RANK,
  shouldEnqueueNotifications,
  statusAfterImportScan,
  venueNameFromScan,
} from '@local-events/domain';
import { geocodeSwedishAddress } from './page-place';
import { failFinishedScan, type ScanProgress } from './scan-progress';
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
  /** Unavailable rows whose chat request timed out. Already included in `unavailable`. */
  unavailable_timeout: number;
  skipped: number;
  /** Rows this call claimed, including ones the model could not finish. */
  eventIds: string[];
}

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function eventSummary(value: string): string | null {
  const summary = value.trim();
  return summary.length > 0 ? summary : null;
}

/** The events table only stores `sv` and `en`. A blank or other code stays Swedish. */
function eventLanguage(value: string): 'sv' | 'en' {
  return value.trim().toLowerCase() === 'en' ? 'en' : 'sv';
}

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
  options: {
    limit?: number;
    leaseMs?: number;
    eventId?: string;
    skipEventIds?: readonly string[];
    fetch?: typeof fetch;
    /** RunPod passes this so a save failure moves that event from done to failed. */
    progress?: ScanProgress;
  } = {},
): Promise<ScanSummary> {
  const limit = options.limit ?? SCAN_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? SCAN_LEASE_MS;
  const claimed = await store.claimPendingScans(
    limit,
    leaseMs,
    options.eventId,
    options.skipEventIds,
  );
  const summary: ScanSummary = {
    claimed: claimed.length,
    published: 0,
    review: 0,
    unavailable: 0,
    unavailable_timeout: 0,
    skipped: 0,
    eventIds: claimed.map((row) => row.eventId),
  };
  if (claimed.length === 0) return summary;
  const fetchImpl = options.fetch ?? fetch;
  const batch: ScanInput[] = [];
  const rows = new Map<string, PendingScanRow>();
  for (const row of claimed) {
    await ensureScanPoint(row, fetchImpl);
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
      if (outcome.reason === 'timeout') summary.unavailable_timeout += 1;
      else await notifyTipScan(store, enqueue, row.eventId, 'failed');
      continue;
    }
    let applied: 'published' | 'review' | 'skipped';
    try {
      applied = await applyOutcome(store, row, outcome, enqueue, temporaries, fetchImpl);
    } catch (error) {
      console.error(
        'scan apply failed',
        row.eventId,
        error instanceof Error ? error.message : error,
      );
      await store.releaseScanClaim(row.eventId, row.claimedUntil);
      summary.unavailable += 1;
      if (options.progress) failFinishedScan(options.progress);
      continue;
    }
    if (applied === 'published') summary.published += 1;
    else if (applied === 'review') summary.review += 1;
    else {
      summary.skipped += 1;
      if (options.progress) failFinishedScan(options.progress);
    }
    if (applied !== 'skipped') {
      await notifyTipScan(
        store,
        enqueue,
        row.eventId,
        applied === 'published' ? 'published' : 'in_review',
      );
    }
  }
  return summary;
}

async function notifyTipScan(
  store: IngestStore,
  enqueue: DomainEventSink,
  eventId: string,
  status: 'published' | 'in_review' | 'failed',
): Promise<void> {
  const marked = await store.markTipScanned({ eventId, status, now: new Date() });
  if (!marked) return;
  await emitDomainEvent(enqueue, {
    type: 'tip.scanned',
    tipId: marked.tipId,
    eventId,
    status,
  });
}

/** A user tip is passed as `tip`. The written description stays a separate field. */
function scanDescription(row: PendingScanRow): Pick<ScanInput, 'description' | 'tip'> {
  const text = row.meta.tip?.text?.trim();
  const categoryHint = row.meta.tip?.categoryHint?.trim();
  return {
    ...(row.description ? { description: row.description } : {}),
    ...(text || categoryHint
      ? {
          tip: {
            ...(text ? { text } : {}),
            ...(categoryHint ? { categoryHint } : {}),
          },
        }
      : {}),
  };
}

export function scanInputFor(row: PendingScanRow): ScanInput {
  const organizerKeys = row.meta.import?.organizerKeys ?? [];
  const venue = importedVenueName(row.meta.import);
  return {
    eventId: row.eventId,
    title: row.title,
    ...scanDescription(row),
    ...(venue ? { venue } : {}),
    startsAt: row.startsAt?.toISOString() ?? '',
    endsAt: row.endsAt?.toISOString() ?? '',
    ...(row.location ? { location: row.location } : {}),
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    links: row.links,
    pageLinks: row.pageLinks,
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

export async function applyOutcome(
  store: IngestStore,
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  enqueue: DomainEventSink,
  temporaries: Map<string, PublisherLink>,
  fetchImpl: typeof fetch,
  persist: (input: Parameters<IngestStore['finishImportedScan']>[0]) => Promise<boolean> = (
    input,
  ) => store.finishImportedScan(input),
): Promise<'published' | 'review' | 'skipped'> {
  const publisher = await publisherFor(store, row, outcome, temporaries);
  const status = statusAfterImportScan({
    approved: outcome.approved,
    publisherStatus: publisher.status,
    publisherIsTemporary: publisher.isTemporary,
    sourceTrust: row.sourceTrust,
    possibleDuplicate: outcome.duplicate !== null,
  });
  const tagIds = await store.tagIdsForExternalIds(outcome.tags.map((tag) => tag.externalId));
  const meta = { ...row.meta };
  if (outcome.duplicate) meta.possibleDuplicate = outcome.duplicate;
  else delete meta.possibleDuplicate;
  const instructions = readScanInstructions(outcome.instructions);
  if (instructions.length > 0) meta.instructions = instructions;
  else delete meta.instructions;
  const group = await occasionGroupFor(store, row, outcome.occasionMatches ?? []);
  if (group) {
    meta.possibleOccasionGroupId = group.groupId;
    await store.setPossibleOccasionGroup(group.memberIds, group.groupId);
  } else {
    const stored = await store.listOccasionGroups([row.eventId]);
    const kept = stored[0]?.possibleOccasionGroupId;
    if (kept) meta.possibleOccasionGroupId = kept;
  }
  const occasions = occasionsFromScan(outcome);
  const place = await placeFromScan(row, outcome, fetchImpl);
  const location = place.location ?? row.location ?? undefined;
  const venueName = venueNameFromScan(outcome.possibleVenueNames, row.meta.import);
  if (place.address) meta.address = place.address;
  const saved = await persist({
    eventId: row.eventId,
    publisherId: publisher.publisherId,
    status,
    meta,
    tagIds,
    llmOutput: outcome.llmOutput ?? {},
    contentVerdict: outcome.contentVerdict,
    summary: eventSummary(outcome.summary),
    language: eventLanguage(outcome.language),
    claimedUntil: row.claimedUntil,
    ...(occasions.length > 0 ? { occasions } : {}),
    ...(location ? { location } : {}),
    ...(venueName ? { venueName } : {}),
  });
  if (!saved) return 'skipped';
  const startsAt = row.startsAt ?? occasions[0]?.startsAt;
  if (store.scheduleImportNotifications && startsAt) {
    const planId = importPlanToSchedule({
      publisherStatus: publisher.status,
      planId: publisher.importNotificationPlan,
    });
    if (planId) {
      await store.scheduleImportNotifications({
        eventId: row.eventId,
        eventTitle: row.title,
        startsAt,
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

/**
 * A point already on the occasion or the scraped address is kept. Otherwise the
 * scraped address is geocoded so nearby tools can use it. The address from the
 * scan JSON is used only when the import stored none. The model does not supply
 * the point.
 */
function addressPoint(
  location: { lat: number; lng: number } | undefined,
): { lat: number; lng: number } | undefined {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    return undefined;
  }
  if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
    return undefined;
  }
  return { lat: location.lat, lng: location.lng };
}

async function ensureScanPoint(row: PendingScanRow, fetchImpl: typeof fetch): Promise<void> {
  if (row.location) return;
  const stored = addressPoint(row.meta.address?.location);
  if (stored) {
    row.location = stored;
    return;
  }
  if (!row.meta.address) return;
  const location = await geocodeSwedishAddress(row.meta.address, fetchImpl);
  if (location) row.location = location;
}

async function placeFromScan(
  row: PendingScanRow,
  outcome: Extract<ScanOutcome, { ok: true }>,
  fetchImpl: typeof fetch,
): Promise<{
  location?: { lat: number; lng: number };
  address?: NonNullable<PendingScanRow['meta']['address']>;
}> {
  const scraped = row.meta.address;
  const chosen = scraped ?? outcome.address;
  if (row.location) {
    if (scraped && !scraped.location) {
      return { location: row.location, address: { ...scraped, location: row.location } };
    }
    if (!scraped && chosen) return { location: row.location, address: chosen };
    return { location: row.location };
  }
  if (!chosen) return {};
  const location = await geocodeSwedishAddress(chosen, fetchImpl);
  const address = location ? { ...chosen, location } : chosen;
  return {
    ...(location ? { location } : {}),
    address,
  };
}

/**
 * Showings from the scan. `possibleOccasions` wins. An older outcome that only
 * set `startsAt` and `endsAt` is one showing. A one-sided range is dropped.
 * The earliest start is first, so a notification can use it when the event has none.
 */
function occasionsFromScan(
  outcome: Extract<ScanOutcome, { ok: true }>,
): { startsAt: Date; endsAt: Date; venueName: string | null }[] {
  const listed =
    outcome.possibleOccasions ??
    (outcome.startsAt && outcome.endsAt
      ? [{ startsAt: outcome.startsAt, endsAt: outcome.endsAt }]
      : []);
  const occasions: { startsAt: Date; endsAt: Date; venueName: string | null }[] = [];
  for (const item of listed) {
    const startsAt = new Date(item.startsAt);
    const endsAt = new Date(item.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
    if (endsAt.getTime() < startsAt.getTime()) continue;
    const raw = 'venueName' in item ? item.venueName : undefined;
    const venueName = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    occasions.push({ startsAt, endsAt, venueName: venueName || null });
  }
  return occasionsToAdd([], occasions).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Reuses an occasion id already stored on this event or a high-ranked duplicate.
 * A new id is written onto each of those duplicates. This event receives it
 * through the scan meta, because finishing the scan replaces that object.
 */
async function occasionGroupFor(
  store: IngestStore,
  row: PendingScanRow,
  matches: { eventId: string; occasionRank: number }[],
): Promise<{ groupId: string; memberIds: string[] } | null> {
  const known = matches.filter(
    (match) => EVENT_ID.test(match.eventId) && match.eventId !== row.eventId,
  );
  if (known.length === 0) return null;
  const stored = await store.listOccasionGroups([
    row.eventId,
    ...known.map((match) => match.eventId),
  ]);
  const byId = new Map(stored.map((item) => [item.eventId, item]));
  const self = byId.get(row.eventId);
  const possibleOccasionGroupId = self?.possibleOccasionGroupId ?? row.meta.possibleOccasionGroupId;
  const duplicates = known.flatMap((match) => {
    const existing = byId.get(match.eventId);
    if (!existing) return [];
    return [
      {
        occasionRank: match.occasionRank,
        ...(existing.possibleOccasionGroupId
          ? { possibleOccasionGroupId: existing.possibleOccasionGroupId }
          : {}),
      },
    ];
  });
  const groupId = choosePossibleOccasionGroupId({
    event: {
      ...(possibleOccasionGroupId ? { possibleOccasionGroupId } : {}),
    },
    duplicates,
    newId: randomUUID(),
  });
  if (!groupId) return null;
  const memberIds = known
    .filter((match) => match.occasionRank > OCCASION_GROUP_MIN_RANK && byId.has(match.eventId))
    .map((match) => match.eventId);
  return { groupId, memberIds };
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
    status: outcome.publisher.status,
    importNotificationPlan: outcome.publisher.importNotificationPlan,
  };
}

import {
  importPlanToSchedule,
  mergeImportedLinks,
  statusOnPublish,
  type EventStatus,
  validateEventFields,
} from '@local-events/domain';
import { contentHash, type IncomingEvent } from '@local-events/ingest';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import { noopEventImageUploader, type EventImageUploader } from './event-images';
import { noopRawPayloadSink, type RawPayloadSink } from './raw-payload';
import { eachSourceRun, runSource, sourceSavesEachEvent } from './run';
import { fillMissingVenueNames, geocodeDelayMs } from './venue-city';
import { LOCAL_ORGANIZER_SLUGS } from './sources';
import type { IngestStore, PublisherLink, SourceRecord } from './store';

export interface PersistSummary {
  source: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: { externalId: string | undefined; issues: string }[];
  rejected: { externalId: string; reason: string }[];
}

const UPDATED_FIELDS = [
  'title',
  'description',
  'mode',
  'startsAt',
  'endsAt',
  'timezone',
  'location',
  'sourceUrl',
  'onlineUrl',
  'priceAmount',
  'currency',
  'links',
  'publisherId',
  'tagIds',
];

interface CollectedRun {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: PersistSummary['invalid'];
  rejected: PersistSummary['rejected'];
  problems: string[];
  raw: unknown;
}

function runProblems(
  invalid: PersistSummary['invalid'],
  rejected: PersistSummary['rejected'],
): string[] {
  return [
    ...invalid.map((item) => item.issues),
    ...rejected.map((item) => `${item.externalId}: ${item.reason}`),
  ];
}

function archiveRaw(parts: unknown[]): unknown {
  const products: unknown[] = [];
  let now = '';
  let origin = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object' || !('products' in part)) return parts;
    const record = part as { products?: unknown; now?: unknown; origin?: unknown };
    if (!Array.isArray(record.products)) return parts;
    products.push(...record.products);
    if (typeof record.now === 'string') now = record.now;
    if (typeof record.origin === 'string') origin = record.origin;
  }
  return { now, origin, products };
}

function namedEvents(events: IncomingEvent[], config: Record<string, unknown>) {
  return fillMissingVenueNames(events, fetch, {
    delayMs: geocodeDelayMs(config),
    log: (message, data) => console.log(JSON.stringify({ message, ...data })),
  });
}

async function persistWholeRun(
  store: IngestStore,
  source: SourceRecord,
  slug: string,
  config: Record<string, unknown>,
  enqueue: DomainEventSink,
  images: EventImageUploader,
  limit?: number,
): Promise<CollectedRun> {
  const run = await runSource(slug, config, limit);
  await store.upsertTags([...run.tags, ...run.events.flatMap((event) => event.tags)]);
  const saved = await saveIncomingEvents(
    store,
    source,
      await namedEvents(run.events, config),
    enqueue,
    images,
  );
  return {
    fetched: run.valid,
    created: saved.created,
    updated: saved.updated,
    skipped: saved.skipped,
    invalid: run.invalid,
    rejected: saved.rejected,
    problems: runProblems(run.invalid, saved.rejected),
    raw: run.raw,
  };
}

async function persistEachEvent(
  store: IngestStore,
  source: SourceRecord,
  slug: string,
  config: Record<string, unknown>,
  enqueue: DomainEventSink,
  images: EventImageUploader,
  limit?: number,
): Promise<CollectedRun> {
  const invalid: PersistSummary['invalid'] = [];
  const rejected: PersistSummary['rejected'] = [];
  const raws: unknown[] = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let remaining = limit;
  for await (const batch of eachSourceRun(slug, config, limit)) {
    const events = remaining == null ? batch.events : batch.events.slice(0, remaining);
    if (events.length === 0) break;
    await store.upsertTags([...batch.tags, ...events.flatMap((event) => event.tags)]);
    const saved = await saveIncomingEvents(
      store,
      source,
      await namedEvents(events, config),
      enqueue,
      images,
    );
    fetched += events.length;
    created += saved.created;
    updated += saved.updated;
    skipped += saved.skipped;
    invalid.push(...batch.invalid);
    rejected.push(...saved.rejected);
    raws.push(batch.raw);
    if (remaining != null) {
      remaining -= events.length;
      if (remaining <= 0) break;
    }
  }
  return {
    fetched,
    created,
    updated,
    skipped,
    invalid,
    rejected,
    problems: runProblems(invalid, rejected),
    raw: archiveRaw(raws),
  };
}

/**
 * Fetch one source and upsert its events.
 * A new import is saved as `pending_scan` with no publisher. The scan job resolves
 * the publisher, duplicate check, and tags, then moves the row to `in_review` or
 * `published`. An unchanged content hash is skipped. A row already in review or
 * published is updated in place.
 */
export async function persistSource(
  store: IngestStore,
  slug: string,
  enqueue: DomainEventSink = noopDomainEvents,
  rawSink: RawPayloadSink = noopRawPayloadSink,
  images: EventImageUploader = noopEventImageUploader,
  limit?: number,
): Promise<PersistSummary> {
  const source = await store.getSource(slug);
  if (!source) throw new Error(`No data_sources row for "${slug}"`);
  const runId = await store.startRun(source.id);
  try {
    const config = source.config;
    const collected = sourceSavesEachEvent(slug)
      ? await persistEachEvent(store, source, slug, config, enqueue, images, limit)
      : await persistWholeRun(store, source, slug, config, enqueue, images, limit);
    try {
      await rawSink.save({ sourceSlug: slug, runId, raw: collected.raw });
    } catch (err) {
      // Best-effort: do not fail the DB upsert if raw archival fails.
      console.warn(
        JSON.stringify({
          source: slug,
          runId,
          message: 'raw payload upload failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    await store.finishRun(runId, {
      status: 'ok',
      fetched: collected.fetched,
      created: collected.created,
      updated: collected.updated,
      skipped: collected.skipped,
      error:
        collected.problems.length > 0
          ? collected.problems.slice(0, 5).join('; ').slice(0, 500)
          : null,
    });
    return {
      source: slug,
      fetched: collected.fetched,
      created: collected.created,
      updated: collected.updated,
      skipped: collected.skipped,
      invalid: collected.invalid,
      rejected: collected.rejected,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingestion failed';
    await store.finishRun(runId, {
      status: 'error',
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      error: message.slice(0, 500),
    });
    throw err;
  }
}

export async function saveIncomingEvents(
  store: IngestStore,
  source: SourceRecord,
  events: IncomingEvent[],
  enqueue: DomainEventSink = noopDomainEvents,
  images: EventImageUploader = noopEventImageUploader,
): Promise<Pick<PersistSummary, 'created' | 'updated' | 'skipped' | 'rejected'>> {
  await store.upsertTags(events.flatMap((event) => event.tags));
  const counts = { created: 0, updated: 0, skipped: 0, rejected: [] as PersistSummary['rejected'] };
  for (const event of events) {
    const outcome = await saveOne(store, source, event, enqueue, images);
    if (outcome === 'created') counts.created += 1;
    else if (outcome === 'updated') counts.updated += 1;
    else if (outcome === 'skipped') counts.skipped += 1;
    else counts.rejected.push(outcome);
  }
  return counts;
}

function imageSources(event: IncomingEvent): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const url of [event.imageUrl, ...(event.imageUrls ?? [])]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls.slice(0, 9);
}

async function attachImages(
  store: IngestStore,
  eventId: string,
  event: IncomingEvent,
  images: EventImageUploader,
): Promise<void> {
  const urls = imageSources(event);
  const roles: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const role = index === 0 ? 'main' : `gallery-${index}`;
    const sourceUrl = urls[index]!;
    roles.push(role);
    const current = await store.findEventImage(eventId, role);
    if (current?.sourceUrl === sourceUrl) continue;
    try {
      const stored = await images.put({ eventId, sourceUrl, role });
      if (!stored) continue;
      await store.saveEventImage({
        eventId,
        role,
        s3Key: stored.s3Key,
        sourceUrl,
        contentType: stored.contentType,
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          eventId,
          message: 'event image upload failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  // A missing imageUrls means the crawl did not finish. Leave earlier gallery rows.
  if (!event.imageUrls) return;
  const existing = await store.listEventImages(eventId);
  const stale = existing
    .map((image) => image.role)
    .filter((role) => role.startsWith('gallery-') && !roles.includes(role));
  if (stale.length > 0) await store.deleteEventImages(eventId, stale);
}

function importedEndsAt(event: IncomingEvent): string | null {
  if (!event.startsAt) return null;
  return event.endsAt ?? event.startsAt;
}

async function scheduleImportedNotifications(
  store: IngestStore,
  input: {
    eventId: string;
    eventTitle: string;
    startsAt: string;
    status: EventStatus;
    publisher: PublisherLink;
  },
) {
  const planId = importPlanToSchedule({
    publisherStatus: input.publisher.status,
    planId: input.publisher.importNotificationPlan,
  });
  if (!planId || !store.scheduleImportNotifications) return;
  if (input.status === 'cancelled' || input.status === 'ended') return;
  await store.scheduleImportNotifications({
    eventId: input.eventId,
    eventTitle: input.eventTitle,
    startsAt: new Date(input.startsAt),
    planId,
    status: input.status,
  });
}

function storedImportName(value: string | undefined): string | undefined {
  const name = value?.replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 500) : undefined;
}

/** The venue column stays empty until the scan. The imported names live on `meta.import`. */
function withImportContext(event: IncomingEvent): IncomingEvent {
  const venueName = storedImportName(event.venueName);
  const arenaName = storedImportName(event.arenaName);
  const { venueName: _venue, arenaName: _arena, meta, ...rest } = event;
  return {
    ...rest,
    meta: {
      ...meta,
      import: {
        ...meta?.import,
        organizerKeys: event.organizerKeys,
        ...(event.organizerName ? { organizerName: event.organizerName } : {}),
        ...(venueName ? { venueName } : {}),
        ...(arenaName ? { arenaName } : {}),
      },
    },
  };
}

async function saveOne(
  store: IngestStore,
  source: SourceRecord,
  event: IncomingEvent,
  enqueue: DomainEventSink,
  images: EventImageUploader,
): Promise<'created' | 'updated' | 'skipped' | { externalId: string; reason: string }> {
  const fields = validateEventFields({
    mode: event.mode,
    location: event.location ?? null,
    onlineUrl: event.onlineUrl ?? null,
  });
  if (!fields.ok) return { externalId: event.externalId, reason: fields.reason };
  if (await store.isImportSuppressed(source.id, event.externalId)) return 'skipped';

  const linked = withImportContext({
    ...event,
    links: mergeImportedLinks(event.links, event.description),
  });
  const hash = contentHash(linked);
  const tagIds = await store.tagIdsForExternalIds(event.tags.map((tag) => tag.externalId));
  const existing = await store.findExternalRef(source.id, event.externalId);
  if (existing && existing.contentHash === hash) {
    await store.touchRef(source.id, event.externalId);
    await attachImages(store, existing.eventId, event, images);
    return 'skipped';
  }
  if (existing && (existing.status === 'cancelled' || existing.status === 'ended')) {
    await store.touchRef(source.id, event.externalId);
    return 'skipped';
  }

  if (!existing || existing.status === 'pending_scan') {
    const write = {
      sourceId: source.id,
      externalId: event.externalId,
      contentHash: hash,
      publisherId: null,
      status: 'pending_scan' as const,
      event: linked,
      endsAt: importedEndsAt(event),
      tagIds,
      refId: event.externalId,
      workerId: source.slug,
    };
    if (!existing) {
      const eventId = await store.insertImported(write);
      await attachImages(store, eventId, event, images);
      return 'created';
    }
    const saved = await store.updateImported(existing.eventId, write);
    if (!saved) return 'skipped';
    await attachImages(store, existing.eventId, event, images);
    return 'updated';
  }

  let publisher = await store.findPublisher(source.id, event.organizerKeys, {
    ...(event.location ? { location: event.location } : {}),
    localSlugs: [...new Set([source.slug, ...LOCAL_ORGANIZER_SLUGS])],
  });
  if (!publisher) {
    publisher = await store.createTemporaryPublisher({
      sourceId: source.id,
      organizerKeys: event.organizerKeys,
      name: event.organizerName?.trim() || event.organizerKeys[0]!,
    });
  } else {
    await store.rememberOrganizerKeys(source.id, publisher.publisherId, event.organizerKeys);
  }
  const write = {
    sourceId: source.id,
    externalId: event.externalId,
    contentHash: hash,
    publisherId: publisher.publisherId,
    status: statusOnPublish({
      origin: 'imported' as const,
      sourceTrust: source.trust,
      publisherIsTemporary: publisher.isTemporary,
    }),
    event: linked,
    endsAt: importedEndsAt(event),
    tagIds,
    refId: event.externalId,
    workerId: source.slug,
  };
  if (!(await store.sourceOwnsEvent(source.id, existing.eventId))) {
    await store.noteRef(source.id, event.externalId, hash);
    return 'skipped';
  }
  await store.updateImported(existing.eventId, write);
  await attachImages(store, existing.eventId, event, images);
  if (event.startsAt) {
    await scheduleImportedNotifications(store, {
      eventId: existing.eventId,
      eventTitle: event.title,
      startsAt: event.startsAt,
      status: existing.status,
      publisher,
    });
  }
  if (existing.status === 'published') {
    await emitDomainEvent(enqueue, {
      type: 'event.updated',
      eventId: existing.eventId,
      changedFields: UPDATED_FIELDS,
    });
  }
  return 'updated';
}

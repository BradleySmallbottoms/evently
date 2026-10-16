import {
  duplicateIdsMatch,
  duplicateLinksMatch,
  importPlanToSchedule,
  mergeImportedLinks,
  preferDuplicate,
  shouldEnqueueNotifications,
  statusOnPublish,
  withinDuplicateWindow,
  duplicateSignal,
  type DuplicateSignal,
  type EventStatus,
  validateEventFields,
} from '@local-events/domain';
import {
  contentHash,
  existingEventTags,
  matchEventTag,
  tagCatalog,
  titleSimilarity,
  type IncomingEvent,
  type TagChoice,
} from '@local-events/ingest';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import { noopEventImageUploader, type EventImageUploader } from './event-images';
import { noopRawPayloadSink, type RawPayloadSink } from './raw-payload';
import { eachSourceRun, runSource, sourceSavesEachEvent } from './run';
import { fillMissingVenueNames, geocodeDelayMs } from './venue-city';
import { LOCAL_ORGANIZER_SLUGS } from './sources';
import type { DuplicateCandidate, IngestStore, PublisherLink, SourceRecord } from './store';

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
  'venueName',
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

async function attachMatchedTags(
  events: IncomingEvent[],
  config: Record<string, unknown>,
): Promise<IncomingEvent[]> {
  const catalog = tagCatalog(config);
  if (catalog.length === 0) return events;
  const stored = existingEventTags(config);
  let unavailable = false;
  const cache = new Map<string, TagChoice[]>();
  const tagged: IncomingEvent[] = [];
  for (const event of events) {
    if (event.tags.length > 0) {
      tagged.push(event);
      continue;
    }
    const kept = stored.filter((row) => row.externalId === event.externalId).map((row) => row.tag);
    if (kept.length > 0) {
      tagged.push({ ...event, tags: kept });
      continue;
    }
    if (unavailable) {
      tagged.push(event);
      continue;
    }
    const cached = cache.get(event.title);
    if (cached) {
      tagged.push({ ...event, tags: cached });
      continue;
    }
    const result = await matchEventTag(
      {
        title: event.title,
        ...(event.description ? { description: event.description } : {}),
        ...(event.venueName ? { venue: event.venueName } : {}),
      },
      catalog,
      config,
      fetch,
    );
    if (!result.ok) {
      unavailable = true;
      tagged.push(event);
      continue;
    }
    cache.set(event.title, result.tags);
    tagged.push(result.tags.length > 0 ? { ...event, tags: result.tags } : event);
  }
  return tagged;
}

async function persistWholeRun(
  store: IngestStore,
  source: SourceRecord,
  slug: string,
  config: Record<string, unknown>,
  enqueue: DomainEventSink,
  images: EventImageUploader,
): Promise<CollectedRun> {
  const run = await runSource(slug, config);
  await store.upsertTags([...run.tags, ...run.events.flatMap((event) => event.tags)]);
  const saved = await saveIncomingEvents(
    store,
    source,
    await attachMatchedTags(await namedEvents(run.events, config), config),
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
): Promise<CollectedRun> {
  const invalid: PersistSummary['invalid'] = [];
  const rejected: PersistSummary['rejected'] = [];
  const raws: unknown[] = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for await (const batch of eachSourceRun(slug, config)) {
    await store.upsertTags([...batch.tags, ...batch.events.flatMap((event) => event.tags)]);
    const saved = await saveIncomingEvents(
      store,
      source,
      await attachMatchedTags(await namedEvents(batch.events, config), config),
      enqueue,
      images,
    );
    fetched += batch.valid;
    created += saved.created;
    updated += saved.updated;
    skipped += saved.skipped;
    invalid.push(...batch.invalid);
    rejected.push(...saved.rejected);
    raws.push(batch.raw);
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
 * Review-trust and temporary publishers stay `in_review` and are not announced.
 * A verified publisher with a plan still gets reminders: approved when the event
 * is published, pending while it is in review.
 * An unchanged content hash is skipped. A lookalike within 200 m and 30 minutes
 * is saved as its own in_review event and flagged in meta.
 */
export async function persistSource(
  store: IngestStore,
  slug: string,
  enqueue: DomainEventSink = noopDomainEvents,
  rawSink: RawPayloadSink = noopRawPayloadSink,
  images: EventImageUploader = noopEventImageUploader,
): Promise<PersistSummary> {
  const source = await store.getSource(slug);
  if (!source) throw new Error(`No data_sources row for "${slug}"`);
  const runId = await store.startRun(source.id);
  try {
    const config = {
      ...source.config,
      tagCatalog: await store.listTags(),
      existingEventTags: await store.listEventTags(source.id),
    };
    const collected = sourceSavesEachEvent(slug)
      ? await persistEachEvent(store, source, slug, config, enqueue, images)
      : await persistWholeRun(store, source, slug, config, enqueue, images);
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
    publisherVerified: input.publisher.verified,
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

async function possibleDuplicate(
  store: IngestStore,
  event: IncomingEvent,
  startsAt: Date,
  location: { lat: number; lng: number },
  workerId: string,
) {
  const incomingIds = [event.externalId];
  const incomingUrls = [event.sourceUrl, ...(event.links ?? []).map((link) => link.url)];
  let best: { candidate: DuplicateCandidate; signal: DuplicateSignal } | null = null;
  // console.log('duplicateCandidates', { location, startsAt }, await store.duplicateCandidates({ location, startsAt }));
  for (const candidate of await store.duplicateCandidates({ location, startsAt })) {
    const sameRow =
      candidate.workerId === workerId &&
      (candidate.refId === event.externalId || candidate.externalIds.includes(event.externalId));
    if (sameRow) continue;
    const signal = duplicateSignal({
      distanceM: candidate.distanceM,
      withinWindow: withinDuplicateWindow(startsAt, candidate.startsAt),
      titleSimilarity: titleSimilarity(event.title, candidate.title),
      sharedLink: duplicateLinksMatch(incomingUrls, [candidate.sourceUrl, ...candidate.links]),
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
  console.log('best', best);
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

  const linked = {
    ...event,
    links: mergeImportedLinks(event.links, event.description),
  };

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
    contentHash: contentHash(linked),
    publisherId: publisher.publisherId,
    status: statusOnPublish({
      origin: 'imported',
      sourceTrust: source.trust,
      publisherIsTemporary: publisher.isTemporary,
    }),
    event: linked,
    endsAt: event.endsAt ?? event.startsAt,
    tagIds: await store.tagIdsForExternalIds(event.tags.map((tag) => tag.externalId)),
    refId: event.externalId,
    workerId: source.slug,
  };

  const existing = await store.findExternalRef(source.id, event.externalId);
  if (existing) {
    if (existing.contentHash === write.contentHash) {
      await store.touchRef(source.id, event.externalId);
      await attachImages(store, existing.eventId, event, images);
      return 'skipped';
    }
    if (existing.status === 'cancelled' || existing.status === 'ended') {
      await store.touchRef(source.id, event.externalId);
      return 'skipped';
    }
    if (!(await store.sourceOwnsEvent(source.id, existing.eventId))) {
      await store.noteRef(source.id, event.externalId, write.contentHash);
      return 'skipped';
    }
    await store.updateImported(existing.eventId, write);
    await attachImages(store, existing.eventId, event, images);
    await scheduleImportedNotifications(store, {
      eventId: existing.eventId,
      eventTitle: event.title,
      startsAt: event.startsAt,
      status: write.status,
      publisher,
    });
    if (existing.status === 'published') {
      await emitDomainEvent(enqueue, {
        type: 'event.updated',
        eventId: existing.eventId,
        changedFields: UPDATED_FIELDS,
      });
    }
    return 'updated';
  }

  const startsAt = new Date(event.startsAt);
  const duplicate = event.location
    ? await possibleDuplicate(store, linked, startsAt, event.location, source.slug)
    : null;
  if (duplicate) {
    write.status = 'in_review';
    write.event = {
      ...write.event,
      meta: { ...write.event.meta, possibleDuplicate: duplicate },
    };
  }

  const eventId = await store.insertImported(write);
  await attachImages(store, eventId, event, images);
  await scheduleImportedNotifications(store, {
    eventId,
    eventTitle: event.title,
    startsAt: event.startsAt,
    status: write.status,
    publisher,
  });
  if (shouldEnqueueNotifications(write.status)) {
    await emitDomainEvent(enqueue, { type: 'event.published', eventId });
  }
  return 'created';
}

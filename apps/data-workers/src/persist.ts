import {
  mergeImportedLinks,
  shouldEnqueueNotifications,
  statusOnPublish,
  validateEventFields,
} from '@local-events/domain';
import { contentHash, isLikelySameEvent, type IncomingEvent } from '@local-events/ingest';
import { emitDomainEvent, noopDomainEvents, type DomainEventSink } from './domain-events';
import { noopEventImageUploader, type EventImageUploader } from './event-images';
import { noopRawPayloadSink, type RawPayloadSink } from './raw-payload';
import { runSource } from './run';
import type { IngestStore, SourceRecord } from './store';

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

/**
 * Fetch one source and upsert its events.
 * Review-trust and temporary publishers stay `in_review` and are not announced.
 * An unchanged content hash is skipped. A cross-source match links the ref and
 * leaves the existing event alone.
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
    const run = await runSource(slug, source.config);
    try {
      await rawSink.save({ sourceSlug: slug, runId, raw: run.raw });
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
    await store.upsertTags([
      ...run.tags,
      ...run.events.flatMap((event) => event.tags),
    ]);
    const saved = await saveIncomingEvents(store, source, run.events, enqueue, images);
    const problems = [
      ...run.invalid.map((item) => item.issues),
      ...saved.rejected.map((item) => `${item.externalId}: ${item.reason}`),
    ];
    await store.finishRun(runId, {
      status: 'ok',
      fetched: run.valid,
      created: saved.created,
      updated: saved.updated,
      skipped: saved.skipped,
      error: problems.length > 0 ? problems.slice(0, 5).join('; ').slice(0, 500) : null,
    });
    return {
      source: slug,
      fetched: run.valid,
      created: saved.created,
      updated: saved.updated,
      skipped: saved.skipped,
      invalid: run.invalid,
      rejected: saved.rejected,
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

async function attachImage(
  store: IngestStore,
  eventId: string,
  event: IncomingEvent,
  images: EventImageUploader,
): Promise<void> {
  if (!event.imageUrl) return;
  const current = await store.findEventImage(eventId);
  if (current?.sourceUrl === event.imageUrl) return;
  try {
    const stored = await images.put({ eventId, sourceUrl: event.imageUrl });
    if (!stored) return;
    await store.saveEventImage({
      eventId,
      s3Key: stored.s3Key,
      sourceUrl: event.imageUrl,
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

  const linked = {
    ...event,
    links: mergeImportedLinks(event.links, event.description),
  };

  let publisher = await store.findPublisher(source.id, event.organizerKey);
  if (!publisher) {
    publisher = await store.createTemporaryPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKey,
      name: event.organizerName?.trim() || event.organizerKey,
    });
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
  };

  const existing = await store.findExternalRef(source.id, event.externalId);
  if (existing) {
    if (existing.contentHash === write.contentHash) {
      await store.touchRef(source.id, event.externalId);
      await attachImage(store, existing.eventId, event, images);
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
    await attachImage(store, existing.eventId, event, images);
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
  const match = (await store.candidatesNear(startsAt)).find((candidate) =>
    isLikelySameEvent({ title: event.title, startsAt, location: event.location }, candidate),
  );
  if (match) {
    await store.linkExisting({
      sourceId: source.id,
      externalId: event.externalId,
      eventId: match.eventId,
      contentHash: write.contentHash,
    });
    return 'skipped';
  }

  const eventId = await store.insertImported(write);
  await attachImage(store, eventId, event, images);
  if (shouldEnqueueNotifications(write.status)) {
    await emitDomainEvent(enqueue, { type: 'event.published', eventId });
  }
  return 'created';
}

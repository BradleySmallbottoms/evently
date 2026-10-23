import type { Db } from '@local-events/db';
import { readEventMeta } from '@local-events/contracts';
import { mergeEventAddress } from '@local-events/domain';
import { insertApprovedEventReminders, pointEwkt, schema } from '@local-events/db';
import {
  choosePublisher,
  DUPLICATE_RADIUS_M,
  DUPLICATE_WINDOW_MINUTES,
  IMPORT_NOTIFICATION_AUDIENCE,
  importNotificationMessages,
  PUBLISHER_NAME_RADIUS_M,
  pushStatusForEvent,
  sharedOrganizerKeyKind,
  slugifyPublisherName,
  tagSlug,
} from '@local-events/domain';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  type EventRecord,
  type PublisherRecord,
  NEARBY_RADIUS_M,
  PUBLISHER_NAME_SEARCH_RADIUS_M,
  publisherNameMatcher,
  type ImportedScanWrite,
  type ImportedEventWrite,
  type IngestStore,
  type PendingPublisherRow,
  type PendingScanRow,
  type StoredScanRow,
  type ScanPublisherCandidate,
  type NearbyPublisherHit,
  type NearbyEventHit,
  NEARBY_RESULT_LIMIT,
  type PublisherLink,
} from './store';
import { type GeoPoint, type NearbyWindow } from '@local-events/geo';

function eventValues(input: ImportedEventWrite) {
  return {
    publisherId: input.publisherId,
    title: input.event.title,
    description: input.event.description ?? null,
    mode: input.event.mode,
    status: input.status,
    origin: 'imported' as const,
    sourceUrl: input.event.sourceUrl,
    timezone: input.event.timezone,
    onlineUrl: input.event.onlineUrl ?? null,
    priceAmount: input.event.priceAmount ?? null,
    currency: input.event.currency ?? 'SEK',
    meta: input.event.meta ?? {},
    refId: input.refId,
    workerId: input.workerId,
  };
}

function importOccasions(event: ImportedEventWrite['event']) {
  if (event.occasions && event.occasions.length > 0) {
    return event.occasions.map((occasion) => ({
      startsAt: new Date(occasion.startsAt),
      endsAt: new Date(occasion.endsAt),
      venueName: occasion.venueName ?? null,
      location: occasion.location ? pointEwkt(occasion.location) : null,
      sourceKey: occasion.sourceKey ?? `${occasion.startsAt}:${occasion.endsAt}`,
    }));
  }
  if (event.startsAt && event.endsAt) {
    return [
      {
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
        venueName: event.venueName ?? null,
        location: event.location ? pointEwkt(event.location) : null,
        sourceKey: `${event.startsAt}:${event.endsAt}`,
      },
    ];
  }
  return [];
}

async function replaceLinks(
  tx: Pick<Db, 'insert' | 'delete'>,
  eventId: string,
  links: ImportedEventWrite['event']['links'],
) {
  const { eventLinks } = schema;
  await tx
    .delete(eventLinks)
    .where(and(eq(eventLinks.eventId, eventId), eq(eventLinks.audience, 'public')));
  if (!links || links.length === 0) return;
  await tx.insert(eventLinks).values(
    links.map((link, position) => ({
      eventId,
      type: link.type,
      url: link.url,
      label: link.label ?? null,
      position,
      audience: 'public' as const,
    })),
  );
}

export function createDbIngestStore(db: Db): IngestStore {
  const {
    events,
    eventOccasions,
    eventLinks,
    eventTags,
    eventImages,
    tags,
    publishers,
    publisherAliases,
    externalRefs,
    importSuppressions,
    ingestionRuns,
    dataSources,
  } = schema;

  async function uniqueSlug(name: string): Promise<string> {
    const base = slugifyPublisherName(name);
    let slug = base;
    for (let n = 2; n < 50; n += 1) {
      const [taken] = await db
        .select({ id: publishers.id })
        .from(publishers)
        .where(eq(publishers.slug, slug))
        .limit(1);
      if (!taken) return slug;
      slug = `${base}-${n}`.slice(0, 64);
    }
    throw new Error(`Could not allocate a publisher slug for "${name}"`);
  }

  async function writeTags(tx: Pick<Db, 'insert' | 'delete'>, eventId: string, tagIds: string[]) {
    await tx.delete(eventTags).where(eq(eventTags.eventId, eventId));
    if (tagIds.length === 0) return;
    await tx.insert(eventTags).values(tagIds.map((tagId) => ({ eventId, tagId })));
  }

  async function replaceOccasions(
    tx: Pick<Db, 'insert' | 'delete'>,
    eventId: string,
    incoming: ImportedEventWrite['event'],
  ) {
    await tx.delete(eventOccasions).where(eq(eventOccasions.eventId, eventId));
    const occasions = importOccasions(incoming);
    if (occasions.length === 0) return;
    await tx.insert(eventOccasions).values(
      occasions.map((occasion) => ({
        eventId,
        startsAt: occasion.startsAt,
        endsAt: occasion.endsAt,
        venueName: occasion.venueName,
        location: occasion.location,
        sourceKey: occasion.sourceKey,
      })),
    );
  }

  const store: IngestStore = {
    async getSource(slug) {
      const [row] = await db.select().from(dataSources).where(eq(dataSources.slug, slug)).limit(1);
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        trust: row.trust,
        config: (row.config ?? {}) as Record<string, unknown>,
        enabled: row.enabled,
      };
    },
    async startRun(sourceId) {
      const [row] = await db
        .insert(ingestionRuns)
        .values({ sourceId, status: 'running' })
        .returning({ id: ingestionRuns.id });
      if (!row) throw new Error('Failed to start ingestion run');
      return row.id;
    },
    async finishRun(runId, result) {
      await db
        .update(ingestionRuns)
        .set({
          status: result.status,
          finishedAt: new Date(),
          fetched: result.fetched,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          error: result.error,
        })
        .where(eq(ingestionRuns.id, runId));
    },
    async listPublisherCandidates(sourceId, organizerKeys, near) {
      void sourceId;
      if (organizerKeys.length === 0) return [];
      const localSlugs = near?.localSlugs ?? [];
      const nameKeys = organizerKeys.filter(
        (key) => sharedOrganizerKeyKind(key, localSlugs) === 'name',
      );
      const slugKeys = [...new Set(nameKeys.flatMap((key) => [key, slugifyPublisherName(key)]))];
      const aliasRows = await db
        .select({
          organizerKey: publisherAliases.externalOrganizerKey,
          sourceId: publisherAliases.sourceId,
          publisherId: publisherAliases.publisherId,
          isTemporary: publishers.isTemporary,
          status: publishers.status,
          importNotificationPlan: publishers.importNotificationPlan,
          createdAt: publishers.createdAt,
          publisherName: publishers.name,
        })
        .from(publisherAliases)
        .innerJoin(publishers, eq(publishers.id, publisherAliases.publisherId))
        .where(inArray(publisherAliases.externalOrganizerKey, organizerKeys));
      const namedRows =
        nameKeys.length === 0
          ? []
          : await db
              .select({
                publisherId: publishers.id,
                name: publishers.name,
                slug: publishers.slug,
                isTemporary: publishers.isTemporary,
                status: publishers.status,
                importNotificationPlan: publishers.importNotificationPlan,
                createdAt: publishers.createdAt,
                publisherName: publishers.name,
              })
              .from(publishers)
              .where(
                or(
                  inArray(sql`lower(${publishers.name})`, nameKeys),
                  inArray(publishers.slug, slugKeys),
                ),
              );
      const nearIds = new Map<string, number>();
      if (near?.location) {
        const ids = [
          ...new Set([
            ...aliasRows.map((row) => row.publisherId),
            ...namedRows.map((row) => row.publisherId),
          ]),
        ];
        if (ids.length > 0) {
          const point = pointEwkt(near.location);
          const nearby = await db
            .select({
              publisherId: events.publisherId,
              distance: sql<number>`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${point}))`,
            })
            .from(events)
            .innerJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
            .where(
              and(
                inArray(events.publisherId, ids),
                isNotNull(eventOccasions.location),
                notInArray(events.status, ['cancelled', 'ended', 'deleted']),
                sql`ST_DWithin(${eventOccasions.location}, ST_GeogFromText(${point}), ${PUBLISHER_NAME_RADIUS_M})`,
              ),
            );
          for (const row of nearby) {
            if (row.publisherId)
              nearIds.set(
                row.publisherId,
                Math.min(row.distance, nearIds.get(row.publisherId) ?? Infinity),
              );
          }
        }
      }
      const candidates: ScanPublisherCandidate[] = aliasRows.map((row) => ({
        publisherId: row.publisherId,
        sourceId: row.sourceId,
        key: row.organizerKey,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        distanceMeters: nearIds.has(row.publisherId) ? (nearIds.get(row.publisherId) ?? -1) : -1,
        isTemporary: row.isTemporary,
        importNotificationPlan: row.importNotificationPlan,
        organizerKeys: [],
        publisherName: row.publisherName,
      }));
      for (const publisher of namedRows) {
        const nameKey = nameKeys.find(
          (key) =>
            publisher.name.toLocaleLowerCase('sv') === key ||
            publisher.slug === key ||
            publisher.slug === slugifyPublisherName(key),
        );
        if (!nameKey) continue;
        candidates.push({
          publisherId: publisher.publisherId,
          sourceId: null,
          key: nameKey,
          status: publisher.status,
          createdAt: publisher.createdAt.getTime(),
          distanceMeters: nearIds.has(publisher.publisherId)
            ? (nearIds.get(publisher.publisherId) ?? -1)
            : -1,
          isTemporary: publisher.isTemporary,
          importNotificationPlan: publisher.importNotificationPlan,
          organizerKeys: [],
          publisherName: publisher.publisherName,
        });
      }
      const uniquePublishers = new Set(candidates.map((candidate) => candidate.publisherId));
      const result: ScanPublisherCandidate[] = [];
      for (const candidateId of uniquePublishers) {
        const candidate = candidates.find((candidate) => candidate.publisherId === candidateId);
        if (!candidate) continue;
        const aliases = await db
          .select({ key: publisherAliases.externalOrganizerKey })
          .from(publisherAliases)
          .where(eq(publisherAliases.publisherId, candidate.publisherId));
        result.push({ ...candidate, organizerKeys: aliases.map((alias) => alias.key) });
      }
      return result;
    },
    async findPublisher(sourceId, organizerKeys, near) {
      const localSlugs = near?.localSlugs ?? [];
      const candidates = await store.listPublisherCandidates(sourceId, organizerKeys, near);
      const chosen = choosePublisher(sourceId, organizerKeys, localSlugs, candidates);
      const match = candidates.find((row) => row.publisherId === chosen?.publisherId);
      if (!match) return null;
      return {
        publisherId: match.publisherId,
        isTemporary: match.isTemporary,
        status: match.status,
        importNotificationPlan: match.importNotificationPlan,
      };
    },
    async createTemporaryPublisher(input) {
      const slug = await uniqueSlug(input.name);
      return db.transaction(async (tx) => {
        const [publisher] = await tx
          .insert(publishers)
          .values({
            type: 'org',
            name: input.name.slice(0, 200),
            slug,
            status: 'pending_scan',
            origin: 'imported',
            isTemporary: true,
          })
          .returning({ id: publishers.id });
        if (!publisher) throw new Error('Failed to create temporary publisher');
        const organizerKeys = [...new Set(input.organizerKeys)];
        if (organizerKeys.length > 0) {
          await tx.insert(publisherAliases).values(
            organizerKeys.map((organizerKey) => ({
              sourceId: input.sourceId,
              externalOrganizerKey: organizerKey,
              publisherId: publisher.id,
            })),
          );
        }
        return {
          publisherId: publisher.id,
          isTemporary: true,
          status: 'pending_scan',
          importNotificationPlan: null,
        };
      });
    },
    async rememberOrganizerKeys(sourceId, publisherId, organizerKeys) {
      if (organizerKeys.length === 0) return;
      const existing = await db
        .select({ organizerKey: publisherAliases.externalOrganizerKey })
        .from(publisherAliases)
        .where(
          and(
            eq(publisherAliases.sourceId, sourceId),
            eq(publisherAliases.publisherId, publisherId),
            inArray(publisherAliases.externalOrganizerKey, organizerKeys),
          ),
        );
      const taken = new Set(existing.map((row) => row.organizerKey));
      const fresh = [...new Set(organizerKeys.filter((key) => !taken.has(key)))];
      if (fresh.length === 0) return;
      await db.insert(publisherAliases).values(
        fresh.map((organizerKey) => ({
          sourceId,
          externalOrganizerKey: organizerKey,
          publisherId,
        })),
      );
    },
    async sourceOwnsEvent(sourceId, eventId) {
      const [row] = await db
        .select({ id: events.id })
        .from(events)
        .innerJoin(
          publisherAliases,
          and(
            eq(publisherAliases.publisherId, events.publisherId),
            eq(publisherAliases.sourceId, sourceId),
          ),
        )
        .where(eq(events.id, eventId))
        .limit(1);
      return Boolean(row);
    },
    async isImportSuppressed(sourceId, externalId) {
      const [row] = await db
        .select({ externalId: importSuppressions.externalId })
        .from(importSuppressions)
        .where(
          and(
            eq(importSuppressions.sourceId, sourceId),
            eq(importSuppressions.externalId, externalId),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
    async findExternalRef(sourceId, externalId) {
      const [row] = await db
        .select({
          eventId: externalRefs.eventId,
          contentHash: externalRefs.contentHash,
          status: events.status,
        })
        .from(externalRefs)
        .innerJoin(events, eq(events.id, externalRefs.eventId))
        .where(and(eq(externalRefs.sourceId, sourceId), eq(externalRefs.externalId, externalId)))
        .limit(1);
      return row ?? null;
    },
    async listDuplicateCandidates(input) {
      const windowMs = DUPLICATE_WINDOW_MINUTES * 60_000;
      const from = new Date(input.startsAt.getTime() - windowMs);
      const to = new Date(input.startsAt.getTime() + windowMs);
      const point = pointEwkt(input.location);
      const rows = await db
        .select({
          eventId: events.id,
          title: events.title,
          startsAt: eventOccasions.startsAt,
          sourceUrl: events.sourceUrl,
          refId: events.refId,
          workerId: events.workerId,
          lat: sql<number | null>`ST_Y(${eventOccasions.location}::geometry)`,
          lng: sql<number | null>`ST_X(${eventOccasions.location}::geometry)`,
          distanceM: sql<number>`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${point}))`,
        })
        .from(events)
        .innerJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
        .where(
          and(
            isNotNull(eventOccasions.location),
            sql`ST_DWithin(${eventOccasions.location}, ST_GeogFromText(${point}), ${DUPLICATE_RADIUS_M})`,
            gte(eventOccasions.startsAt, from),
            lte(eventOccasions.startsAt, to),
            notInArray(events.status, ['cancelled', 'ended', 'deleted']),
          ),
        );
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.eventId);
      const linkRows = await db
        .select({ eventId: eventLinks.eventId, url: eventLinks.url })
        .from(eventLinks)
        .where(inArray(eventLinks.eventId, ids));
      const refRows = await db
        .select({ eventId: externalRefs.eventId, externalId: externalRefs.externalId })
        .from(externalRefs)
        .where(inArray(externalRefs.eventId, ids));
      const linksByEvent = new Map<string, string[]>();
      for (const link of linkRows) {
        const list = linksByEvent.get(link.eventId) ?? [];
        list.push(link.url);
        linksByEvent.set(link.eventId, list);
      }
      const idsByEvent = new Map<string, string[]>();
      for (const ref of refRows) {
        const list = idsByEvent.get(ref.eventId) ?? [];
        list.push(ref.externalId);
        idsByEvent.set(ref.eventId, list);
      }
      return rows.flatMap((row) => {
        if (row.lat == null || row.lng == null || !row.startsAt) return [];
        return [
          {
            eventId: row.eventId,
            title: row.title,
            startsAt: row.startsAt,
            location: { lat: row.lat, lng: row.lng },
            sourceUrl: row.sourceUrl,
            links: linksByEvent.get(row.eventId) ?? [],
            refId: row.refId,
            workerId: row.workerId,
            externalIds: idsByEvent.get(row.eventId) ?? [],
            distanceM: Number(row.distanceM),
          },
        ];
      });
    },
    async listTags() {
      const rows = await db
        .select({
          externalId: schema.tags.externalId,
          name: schema.tags.name,
          slug: schema.tags.slug,
        })
        .from(schema.tags)
        .where(isNotNull(schema.tags.externalId));
      return rows.flatMap((row) =>
        row.externalId ? [{ externalId: row.externalId, name: row.name, slug: row.slug }] : [],
      );
    },
    async listEventTags(sourceId) {
      const rows = await db
        .select({
          externalId: externalRefs.externalId,
          tagExternalId: tags.externalId,
          name: tags.name,
        })
        .from(externalRefs)
        .innerJoin(eventTags, eq(eventTags.eventId, externalRefs.eventId))
        .innerJoin(tags, eq(tags.id, eventTags.tagId))
        .where(and(eq(externalRefs.sourceId, sourceId), isNotNull(tags.externalId)));
      return rows.flatMap((row) =>
        row.tagExternalId
          ? [{ externalId: row.externalId, tag: { externalId: row.tagExternalId, name: row.name } }]
          : [],
      );
    },
    async upsertTags(incoming) {
      for (const tag of incoming) {
        const [existing] = await db
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.externalId, tag.externalId))
          .limit(1);
        if (existing) {
          await db.update(tags).set({ name: tag.name }).where(eq(tags.id, existing.id));
          continue;
        }
        let slug = tagSlug(tag.name);
        for (let n = 2; n < 50; n += 1) {
          const [taken] = await db
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.slug, slug))
            .limit(1);
          if (!taken) break;
          const suffix = tag.externalId
            .replace(/[^a-z0-9]+/gi, '')
            .slice(-8)
            .toLowerCase();
          slug = `${tagSlug(tag.name)}-${n === 2 ? suffix : `${suffix}-${n}`}`.slice(0, 80);
        }
        await db.insert(tags).values({ slug, name: tag.name, externalId: tag.externalId });
      }
    },
    async tagIdsForExternalIds(externalIds) {
      if (externalIds.length === 0) return [];
      const rows = await db
        .select({ id: tags.id, externalId: tags.externalId })
        .from(tags)
        .where(inArray(tags.externalId, externalIds));
      const byExternal = new Map(rows.map((row) => [row.externalId, row.id]));
      return externalIds.flatMap((externalId) => {
        const id = byExternal.get(externalId);
        return id ? [id] : [];
      });
    },
    async insertImported(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(events)
          .values(eventValues(input))
          .returning({ id: events.id });
        if (!row) throw new Error('Failed to insert imported event');
        await replaceOccasions(tx, row.id, input.event);
        await writeTags(tx, row.id, input.tagIds);
        await replaceLinks(tx, row.id, input.event.links);
        await tx.insert(externalRefs).values({
          sourceId: input.sourceId,
          externalId: input.externalId,
          eventId: row.id,
          contentHash: input.contentHash,
          lastSeenAt: new Date(),
        });
        return row.id;
      });
    },
    async updateImported(eventId, input) {
      const values = eventValues(input);
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select({ meta: events.meta })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);
        const stored = readEventMeta(current?.meta);
        const merged = values.meta.possibleDuplicate
          ? values.meta
          : stored.possibleDuplicate
            ? { ...values.meta, possibleDuplicate: stored.possibleDuplicate }
            : values.meta;
        const address = mergeEventAddress(merged.address, stored.address);
        const meta = address ? { ...merged, address } : merged;
        const updated = await tx
          .update(events)
          .set({
            publisherId: values.publisherId,
            title: values.title,
            description: values.description,
            mode: values.mode,
            sourceUrl: values.sourceUrl,
            timezone: values.timezone,
            ...(input.event.onlineUrl !== undefined ? { onlineUrl: values.onlineUrl } : {}),
            ...(input.event.priceAmount !== undefined ? { priceAmount: values.priceAmount } : {}),
            ...(input.event.currency !== undefined ? { currency: values.currency } : {}),
            meta,
            refId: values.refId,
            workerId: values.workerId,
            scanClaimedUntil: null,
            updatedAt: new Date(),
          })
          .where(
            input.status === 'pending_scan'
              ? and(eq(events.id, eventId), eq(events.status, 'pending_scan'))
              : eq(events.id, eventId),
          )
          .returning({ id: events.id });
        if (updated.length === 0) return false;
        await replaceOccasions(tx, eventId, input.event);
        // An import that names no tags leaves the ones the scan wrote.
        if (input.tagIds.length > 0) await writeTags(tx, eventId, input.tagIds);
        if (input.event.links !== undefined) await replaceLinks(tx, eventId, input.event.links);
        await tx
          .update(externalRefs)
          .set({ contentHash: input.contentHash, lastSeenAt: new Date() })
          .where(
            and(
              eq(externalRefs.sourceId, input.sourceId),
              eq(externalRefs.externalId, input.externalId),
            ),
          );
        return true;
      });
    },
    async touchRef(sourceId, externalId) {
      await db
        .update(externalRefs)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(externalRefs.sourceId, sourceId), eq(externalRefs.externalId, externalId)));
    },
    async noteRef(sourceId, externalId, contentHash) {
      await db
        .update(externalRefs)
        .set({ contentHash, lastSeenAt: new Date() })
        .where(and(eq(externalRefs.sourceId, sourceId), eq(externalRefs.externalId, externalId)));
    },
    async findEventImage(eventId, role = 'main') {
      const [row] = await db
        .select({ sourceUrl: eventImages.sourceUrl, s3Key: eventImages.s3Key })
        .from(eventImages)
        .where(and(eq(eventImages.eventId, eventId), eq(eventImages.role, role)))
        .limit(1);
      return row ?? null;
    },
    async listEventImages(eventId) {
      return db
        .select({
          role: eventImages.role,
          sourceUrl: eventImages.sourceUrl,
          s3Key: eventImages.s3Key,
        })
        .from(eventImages)
        .where(eq(eventImages.eventId, eventId));
    },
    async saveEventImage(input) {
      const role = input.role ?? 'main';
      await db
        .insert(eventImages)
        .values({
          eventId: input.eventId,
          role,
          s3Key: input.s3Key,
          sourceUrl: input.sourceUrl,
          contentType: input.contentType,
        })
        .onConflictDoUpdate({
          target: [eventImages.eventId, eventImages.role],
          set: {
            s3Key: input.s3Key,
            sourceUrl: input.sourceUrl,
            contentType: input.contentType,
          },
        });
    },
    async deleteEventImages(eventId, roles) {
      const gallery = roles.filter((role) => role.startsWith('gallery-'));
      if (gallery.length === 0) return;
      await db
        .delete(eventImages)
        .where(and(eq(eventImages.eventId, eventId), inArray(eventImages.role, gallery)));
    },
    async scheduleImportNotifications(input) {
      const messages = importNotificationMessages({
        planId: input.planId,
        eventTitle: input.eventTitle,
        startsAt: input.startsAt,
        now: new Date(),
      });
      await insertApprovedEventReminders(db, {
        eventId: input.eventId,
        audience: IMPORT_NOTIFICATION_AUDIENCE,
        status: pushStatusForEvent(input.status),
        notifications: messages.map((message) => ({
          titleSv: message.copy.titleSv,
          bodySv: message.copy.bodySv,
          titleEn: message.copy.titleEn,
          bodyEn: message.copy.bodyEn,
          sendAt: message.sendAt,
        })),
      });
    },
    async countPendingScans(eventId) {
      const now = new Date();
      const [row] = await db
        .select({ n: count() })
        .from(events)
        .where(
          and(
            eq(events.status, 'pending_scan'),
            or(isNull(events.scanClaimedUntil), lt(events.scanClaimedUntil, now)),
            ...(eventId ? [eq(events.id, eventId)] : []),
          ),
        );
      return Number(row?.n ?? 0);
    },
    async claimPendingScans(limit, leaseMs, eventId, skipEventIds) {
      const now = new Date();
      const until = new Date(now.getTime() + leaseMs);
      const skip = skipEventIds?.filter((id) => id.length > 0) ?? [];
      return db.transaction(async (tx) => {
        const ids = await tx
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.status, 'pending_scan'),
              or(isNull(events.scanClaimedUntil), lt(events.scanClaimedUntil, now)),
              ...(eventId ? [eq(events.id, eventId)] : []),
              ...(skip.length > 0 ? [notInArray(events.id, skip)] : []),
            ),
          )
          .orderBy(asc(events.createdAt))
          .limit(eventId ? 1 : limit)
          .for('update', { skipLocked: true });
        if (ids.length === 0) return [];
        const idList = ids.map((row) => row.id);
        await tx.update(events).set({ scanClaimedUntil: until }).where(inArray(events.id, idList));
        const rows = await tx
          .select({
            eventId: events.id,
            title: events.title,
            description: events.description,
            sourceUrl: events.sourceUrl,
            refId: events.refId,
            workerId: events.workerId,
            meta: events.meta,
            externalId: externalRefs.externalId,
            sourceId: dataSources.id,
            sourceSlug: dataSources.slug,
            sourceTrust: dataSources.trust,
          })
          .from(events)
          .innerJoin(externalRefs, eq(externalRefs.eventId, events.id))
          .innerJoin(dataSources, eq(dataSources.id, externalRefs.sourceId))
          .where(inArray(events.id, idList));
        const occasionRows = await tx
          .select({
            eventId: eventOccasions.eventId,
            startsAt: eventOccasions.startsAt,
            endsAt: eventOccasions.endsAt,
            venueName: eventOccasions.venueName,
            lat: sql<number | null>`ST_Y(${eventOccasions.location}::geometry)`,
            lng: sql<number | null>`ST_X(${eventOccasions.location}::geometry)`,
          })
          .from(eventOccasions)
          .where(inArray(eventOccasions.eventId, idList))
          .orderBy(asc(eventOccasions.startsAt));
        const linkRows = await tx
          .select({ eventId: eventLinks.eventId, url: eventLinks.url, type: eventLinks.type })
          .from(eventLinks)
          .where(inArray(eventLinks.eventId, idList));
        const tagRows = await tx
          .select({
            eventId: eventTags.eventId,
            tagId: eventTags.tagId,
            externalId: tags.externalId,
            name: tags.name,
          })
          .from(eventTags)
          .innerJoin(tags, eq(tags.id, eventTags.tagId))
          .where(inArray(eventTags.eventId, idList));
        const pending: PendingScanRow[] = [];
        for (const id of idList) {
          const row = rows.find((item) => item.eventId === id);
          if (!row) continue;
          const eventTagsForRow = tagRows.filter((tag) => tag.eventId === id);
          const firstOccasion = occasionRows.find((occasion) => occasion.eventId === id);
          pending.push({
            eventId: row.eventId,
            title: row.title,
            description: row.description,
            venueName: firstOccasion?.venueName ?? null,
            startsAt: firstOccasion?.startsAt ?? null,
            endsAt: firstOccasion?.endsAt ?? null,
            location:
              firstOccasion?.lat == null || firstOccasion?.lng == null
                ? null
                : { lat: firstOccasion.lat, lng: firstOccasion.lng },
            sourceUrl: row.sourceUrl,
            links: linkRows.filter((link) => link.eventId === id).map((link) => link.url),
            pageLinks: linkRows
              .filter((link) => link.eventId === id)
              .flatMap((link) =>
                link.type === 'tickets' ||
                link.type === 'registration' ||
                link.type === 'info' ||
                link.type === 'facebook'
                  ? [{ type: link.type, url: link.url }]
                  : [],
              ),
            externalId: row.externalId,
            workerId: row.workerId ?? row.sourceSlug,
            tagIds: eventTagsForRow.map((tag) => tag.tagId),
            tags: eventTagsForRow.flatMap((tag) =>
              tag.externalId ? [{ externalId: tag.externalId, name: tag.name }] : [],
            ),
            meta: readEventMeta(row.meta),
            sourceId: row.sourceId,
            sourceSlug: row.sourceSlug,
            sourceTrust: row.sourceTrust,
            claimedUntil: until,
          });
        }
        const returned = new Set(pending.map((row) => row.eventId));
        const missing = idList.filter((id) => !returned.has(id));
        if (missing.length > 0) {
          await tx
            .update(events)
            .set({ scanClaimedUntil: null })
            .where(inArray(events.id, missing));
        }
        return pending;
      });
    },
    async listStoredScans(limit, eventId, skipEventIds) {
      const now = new Date();
      const skip = skipEventIds?.filter((id) => id.length > 0) ?? [];
      const rows = await db
        .select({
          eventId: events.id,
          title: events.title,
          description: events.description,
          sourceUrl: events.sourceUrl,
          refId: events.refId,
          workerId: events.workerId,
          meta: events.meta,
          externalId: externalRefs.externalId,
          sourceId: dataSources.id,
          sourceSlug: dataSources.slug,
          sourceTrust: dataSources.trust,
          status: events.status,
          llmOutput: events.llmOutput,
          scanClaimedUntil: events.scanClaimedUntil,
        })
        .from(events)
        .innerJoin(externalRefs, eq(externalRefs.eventId, events.id))
        .innerJoin(dataSources, eq(dataSources.id, externalRefs.sourceId))
        .where(
          and(
            eq(events.origin, 'imported'),
            isNotNull(events.llmOutput),
            inArray(events.status, ['pending_scan', 'in_review', 'published']),
            or(isNull(events.scanClaimedUntil), lt(events.scanClaimedUntil, now)),
            ...(eventId ? [eq(events.id, eventId)] : []),
            ...(skip.length > 0 ? [notInArray(events.id, skip)] : []),
          ),
        )
        .orderBy(asc(events.createdAt))
        .limit(eventId ? 1 : limit);
      if (rows.length === 0) return [];
      const idList = rows.map((row) => row.eventId);
      const occasionRows = await db
        .select({
          eventId: eventOccasions.eventId,
          startsAt: eventOccasions.startsAt,
          endsAt: eventOccasions.endsAt,
          venueName: eventOccasions.venueName,
          lat: sql<number | null>`ST_Y(${eventOccasions.location}::geometry)`,
          lng: sql<number | null>`ST_X(${eventOccasions.location}::geometry)`,
        })
        .from(eventOccasions)
        .where(inArray(eventOccasions.eventId, idList))
        .orderBy(asc(eventOccasions.startsAt));
      const linkRows = await db
        .select({ eventId: eventLinks.eventId, url: eventLinks.url, type: eventLinks.type })
        .from(eventLinks)
        .where(inArray(eventLinks.eventId, idList));
      const tagRows = await db
        .select({
          eventId: eventTags.eventId,
          tagId: eventTags.tagId,
          externalId: tags.externalId,
          name: tags.name,
        })
        .from(eventTags)
        .innerJoin(tags, eq(tags.id, eventTags.tagId))
        .where(inArray(eventTags.eventId, idList));
      const replayable: StoredScanRow[] = [];
      for (const row of rows) {
        const eventTagsForRow = tagRows.filter((tag) => tag.eventId === row.eventId);
        const firstOccasion = occasionRows.find((occasion) => occasion.eventId === row.eventId);
        replayable.push({
          eventId: row.eventId,
          title: row.title,
          description: row.description,
          venueName: firstOccasion?.venueName ?? null,
          startsAt: firstOccasion?.startsAt ?? null,
          endsAt: firstOccasion?.endsAt ?? null,
          location:
            firstOccasion?.lat == null || firstOccasion?.lng == null
              ? null
              : { lat: firstOccasion.lat, lng: firstOccasion.lng },
          sourceUrl: row.sourceUrl,
          links: linkRows.filter((link) => link.eventId === row.eventId).map((link) => link.url),
          pageLinks: linkRows
            .filter((link) => link.eventId === row.eventId)
            .flatMap((link) =>
              link.type === 'tickets' ||
              link.type === 'registration' ||
              link.type === 'info' ||
              link.type === 'facebook'
                ? [{ type: link.type, url: link.url }]
                : [],
            ),
          externalId: row.externalId,
          workerId: row.workerId ?? row.sourceSlug,
          tagIds: eventTagsForRow.map((tag) => tag.tagId),
          tags: eventTagsForRow.flatMap((tag) =>
            tag.externalId ? [{ externalId: tag.externalId, name: tag.name }] : [],
          ),
          meta: readEventMeta(row.meta),
          sourceId: row.sourceId,
          sourceSlug: row.sourceSlug,
          sourceTrust: row.sourceTrust,
          claimedUntil: row.scanClaimedUntil ?? new Date(0),
          status: row.status,
          llmOutput: row.llmOutput,
        });
      }
      return replayable;
    },
    async nearbyEvents(
      point: GeoPoint,
      window: NearbyWindow,
      excludeEventId: string,
    ): Promise<NearbyEventHit[]> {
      const { events, eventOccasions } = schema;
      const ewkt = pointEwkt(point);
      const rows = await db
        .select({
          id: events.id,
          title: events.title,
          startsAt: eventOccasions.startsAt,
          venue: eventOccasions.venueName,
          distanceM: sql<number>`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${ewkt}))`,
        })
        .from(events)
        .innerJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
        .where(
          and(
            isNotNull(eventOccasions.location),
            sql`ST_DWithin(${eventOccasions.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
            gte(eventOccasions.startsAt, window.from),
            lte(eventOccasions.startsAt, window.to),
            notInArray(events.status, ['cancelled', 'ended', 'deleted']),
            ne(events.id, excludeEventId),
          ),
        )
        .orderBy(sql`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${ewkt}))`)
        .limit(NEARBY_RESULT_LIMIT);
      return rows.flatMap((row) => {
        if (!row.startsAt) return [];
        return [
          {
            id: row.id,
            title: row.title,
            startsAt: row.startsAt.toISOString(),
            venue: row.venue,
            distanceM: Math.round(Number(row.distanceM)),
          },
        ];
      });
    },
    /** Occasion ids already stored on these events. Missing ids are left out. */
    async listOccasionGroups(eventIds) {
      if (eventIds.length === 0) return [];
      const { events } = schema;
      const rows = await db
        .select({ id: events.id, meta: events.meta })
        .from(events)
        .where(inArray(events.id, eventIds));
      return rows.map((row) => {
        const meta = readEventMeta(row.meta);
        return {
          eventId: row.id,
          ...(meta.possibleOccasionGroupId
            ? { possibleOccasionGroupId: meta.possibleOccasionGroupId }
            : {}),
        };
      });
    },
    /** Sets the scan occasion group and leaves every other meta key as it is. */
    async setPossibleOccasionGroup(eventIds, groupId) {
      if (eventIds.length === 0) return;
      const { events } = schema;
      await db
        .update(events)
        .set({
          meta: sql`jsonb_set(COALESCE(${events.meta}, '{}'::jsonb), '{possibleOccasionGroupId}', to_jsonb(${groupId}::text), true)`,
          updatedAt: new Date(),
        })
        .where(inArray(events.id, eventIds));
    },
    async getEvent(eventId: string): Promise<EventRecord | null> {
      const { events, eventOccasions } = schema;
      const rows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      if (!row) return null;
      const [firstOccasion] = await db
        .select({ startsAt: eventOccasions.startsAt })
        .from(eventOccasions)
        .where(eq(eventOccasions.eventId, eventId))
        .orderBy(asc(eventOccasions.startsAt))
        .limit(1);
      return {
        eventId: row.id,
        title: row.title,
        startsAt: firstOccasion?.startsAt?.toISOString() ?? '',
        refId: row.refId,
        workerId: row.workerId,
      };
    },
    async getPublisher(publisherId: string): Promise<PublisherRecord | null> {
      const { publishers, publisherAliases } = schema;
      const rows = await db
        .select()
        .from(publishers)
        .where(eq(publishers.id, publisherId))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      if (!row) return null;
      const aliases = await db
        .select({
          key: publisherAliases.externalOrganizerKey,
        })
        .from(publisherAliases)
        .where(eq(publisherAliases.publisherId, publisherId));
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        isTemporary: row.isTemporary,
        importNotificationPlan: row.importNotificationPlan,
        organizerKeys: aliases.map((alias) => alias.key),
        lookup: row.meta.lookup ?? null,
      };
    },
    async rememberPublisherLookup(publisherId, lookup) {
      const { publishers } = schema;
      await db
        .update(publishers)
        .set({
          meta: sql`jsonb_set(COALESCE(${publishers.meta}, '{}'::jsonb), '{lookup}', ${JSON.stringify(lookup)}::jsonb, true)`,
        })
        .where(eq(publishers.id, publisherId));
    },
    async nearbyPublishers(
      point: GeoPoint,
      window: NearbyWindow,
      excludeEventId: string,
    ): Promise<NearbyPublisherHit[]> {
      const { events, eventOccasions, publishers } = schema;
      const ewkt = pointEwkt(point);
      const distance = sql<number>`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${ewkt}))`;
      const rows = await db
        .selectDistinctOn([publishers.id], {
          id: publishers.id,
          name: publishers.name,
          status: publishers.status,
          temporary: publishers.isTemporary,
          nearestEventTitle: events.title,
          distanceM: distance,
        })
        .from(events)
        .innerJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
        .innerJoin(publishers, eq(publishers.id, events.publisherId))
        .where(
          and(
            isNotNull(eventOccasions.location),
            isNotNull(events.publisherId),
            sql`ST_DWithin(${eventOccasions.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
            gte(eventOccasions.startsAt, window.from),
            lte(eventOccasions.startsAt, window.to),
            notInArray(events.status, ['cancelled', 'ended', 'deleted']),
            ne(events.id, excludeEventId),
          ),
        )
        .orderBy(publishers.id, distance);
      const closest = new Map<string, NearbyPublisherHit>();
      for (const row of rows) {
        const aliases = await db
          .select({
            key: publisherAliases.externalOrganizerKey,
          })
          .from(publisherAliases)
          .where(eq(publisherAliases.publisherId, row.id));
        const hit: NearbyPublisherHit = {
          id: row.id,
          name: row.name,
          status: row.status,
          temporary: row.temporary,
          nearestEventTitle: row.nearestEventTitle,
          distanceM: Math.round(Number(row.distanceM)),
          organizerKeys: aliases.map((alias) => alias.key),
        };
        const current = closest.get(hit.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(hit.id, hit);
      }
      return [...closest.values()]
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, NEARBY_RESULT_LIMIT);
    },
    /**
     * Publishers whose name matches the wildcard and that have a non-cancelled event
     * within 50 km. Each publisher is returned once, from its closest such event.
     */
    async publishersByName(point, name, excludeEventId) {
      const matcher = publisherNameMatcher(name);
      if ('error' in matcher) return [];
      const { events, eventOccasions, publishers } = schema;
      const ewkt = pointEwkt(point);
      const distance = sql<number>`ST_Distance(${eventOccasions.location}, ST_GeogFromText(${ewkt}))`;
      const rows = await db
        .selectDistinctOn([publishers.id], {
          id: publishers.id,
          name: publishers.name,
          status: publishers.status,
          temporary: publishers.isTemporary,
          nearestEventTitle: events.title,
          distanceM: distance,
        })
        .from(events)
        .innerJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
        .innerJoin(publishers, eq(publishers.id, events.publisherId))
        .where(
          and(
            isNotNull(eventOccasions.location),
            isNotNull(events.publisherId),
            sql`ST_DWithin(${eventOccasions.location}, ST_GeogFromText(${ewkt}), ${PUBLISHER_NAME_SEARCH_RADIUS_M})`,
            sql`${publishers.name} ILIKE ${matcher.like} ESCAPE '!'`,
            ne(events.status, 'cancelled'),
            ne(events.id, excludeEventId),
          ),
        )
        .orderBy(publishers.id, distance);
      const closest = new Map<string, NearbyPublisherHit>();
      for (const row of rows) {
        const aliases = await db
          .select({ key: publisherAliases.externalOrganizerKey })
          .from(publisherAliases)
          .where(eq(publisherAliases.publisherId, row.id));
        const hit: NearbyPublisherHit = {
          id: row.id,
          name: row.name,
          status: row.status,
          temporary: row.temporary,
          nearestEventTitle: row.nearestEventTitle,
          distanceM: Math.round(Number(row.distanceM)),
          organizerKeys: aliases.map((alias) => alias.key),
        };
        const current = closest.get(hit.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(hit.id, hit);
      }
      return [...closest.values()]
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, NEARBY_RESULT_LIMIT);
    },
    async markTipScanned(input) {
      const [tip] = await db
        .select({ id: schema.eventTips.id })
        .from(schema.eventTips)
        .where(eq(schema.eventTips.eventId, input.eventId))
        .limit(1);
      if (!tip) return null;
      await db
        .update(schema.eventTips)
        .set({
          status: input.status === 'failed' ? 'failed' : 'scanned',
          scanStatus: input.status,
          reviewedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(schema.eventTips.id, tip.id));
      return { tipId: tip.id };
    },
    async releaseScanClaim(eventId, claimedUntil) {
      await db
        .update(events)
        .set({ scanClaimedUntil: null })
        .where(
          and(
            eq(events.id, eventId),
            eq(events.status, 'pending_scan'),
            eq(events.scanClaimedUntil, claimedUntil),
          ),
        );
    },
    async finishImportedScan(input) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(events)
          .set({
            publisherId: input.publisherId,
            status: input.status,
            meta: input.meta,
            scanClaimedUntil: null,
            updatedAt: new Date(),
            llmOutput: input.llmOutput,
            contentVerdict: input.contentVerdict,
            summary: input.summary,
            language: input.language,
            ...(input.startsAt && input.endsAt
              ? { startsAt: input.startsAt, endsAt: input.endsAt }
              : {}),
            ...(input.location ? { location: pointEwkt(input.location) } : {}),
            ...(input.venueName ? { venueName: input.venueName } : {}),
          })
          .where(
            and(
              eq(events.id, input.eventId),
              eq(events.status, 'pending_scan'),
              eq(events.scanClaimedUntil, input.claimedUntil),
            ),
          )
          .returning({ id: events.id });
        if (updated.length === 0) return false;
        await writeTags(tx, input.eventId, input.tagIds);
        return true;
      });
    },
    async reapplyImportedScan(input: ImportedScanWrite) {
      const now = new Date();
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(events)
          .set({
            publisherId: input.publisherId,
            status: input.status,
            meta: input.meta,
            scanClaimedUntil: null,
            updatedAt: new Date(),
            llmOutput: input.llmOutput,
            contentVerdict: input.contentVerdict,
            summary: input.summary,
            language: input.language,
            ...(input.startsAt && input.endsAt
              ? { startsAt: input.startsAt, endsAt: input.endsAt }
              : {}),
            ...(input.location ? { location: pointEwkt(input.location) } : {}),
            ...(input.venueName ? { venueName: input.venueName } : {}),
          })
          .where(
            and(
              eq(events.id, input.eventId),
              eq(events.origin, 'imported'),
              isNotNull(events.llmOutput),
              inArray(events.status, ['pending_scan', 'in_review', 'published']),
              or(isNull(events.scanClaimedUntil), lt(events.scanClaimedUntil, now)),
            ),
          )
          .returning({ id: events.id });
        if (updated.length === 0) return false;
        await writeTags(tx, input.eventId, input.tagIds);
        return true;
      });
    },
    async countPendingPublisherScans(publisherId) {
      const now = new Date();
      const [row] = await db
        .select({ n: count() })
        .from(publishers)
        .where(
          and(
            eq(publishers.status, 'pending_scan'),
            or(isNull(publishers.scanClaimedUntil), lt(publishers.scanClaimedUntil, now)),
            ...(publisherId ? [eq(publishers.id, publisherId)] : []),
          ),
        );
      return Number(row?.n ?? 0);
    },
    async claimPendingPublisherScans(limit, leaseMs, publisherId, skipPublisherIds) {
      const now = new Date();
      const until = new Date(now.getTime() + leaseMs);
      const skip = skipPublisherIds?.filter((id) => id.length > 0) ?? [];
      return db.transaction(async (tx) => {
        const ids = await tx
          .select({ id: publishers.id })
          .from(publishers)
          .where(
            and(
              eq(publishers.status, 'pending_scan'),
              or(isNull(publishers.scanClaimedUntil), lt(publishers.scanClaimedUntil, now)),
              ...(publisherId ? [eq(publishers.id, publisherId)] : []),
              ...(skip.length > 0 ? [notInArray(publishers.id, skip)] : []),
            ),
          )
          .orderBy(asc(publishers.createdAt))
          .limit(publisherId ? 1 : limit)
          .for('update', { skipLocked: true });
        if (ids.length === 0) return [];
        const idList = ids.map((row) => row.id);
        await tx
          .update(publishers)
          .set({ scanClaimedUntil: until })
          .where(inArray(publishers.id, idList));
        const rows = await tx
          .select({
            id: publishers.id,
            name: publishers.name,
          })
          .from(publishers)
          .where(inArray(publishers.id, idList));
        const aliasRows = await tx
          .select({
            publisherId: publisherAliases.publisherId,
            key: publisherAliases.externalOrganizerKey,
          })
          .from(publisherAliases)
          .where(inArray(publisherAliases.publisherId, idList));
        const pending: PendingPublisherRow[] = [];
        for (const id of idList) {
          const row = rows.find((item) => item.id === id);
          if (!row) continue;
          const [event] = await tx
            .select({
              title: events.title,
              description: events.description,
              venueName: eventOccasions.venueName,
              sourceUrl: events.sourceUrl,
              lat: sql<number | null>`ST_Y(${eventOccasions.location}::geometry)`,
              lng: sql<number | null>`ST_X(${eventOccasions.location}::geometry)`,
              sourceId: dataSources.id,
              sourceSlug: dataSources.slug,
            })
            .from(events)
            .leftJoin(eventOccasions, eq(eventOccasions.eventId, events.id))
            .leftJoin(externalRefs, eq(externalRefs.eventId, events.id))
            .leftJoin(dataSources, eq(dataSources.id, externalRefs.sourceId))
            .where(eq(events.publisherId, id))
            .orderBy(desc(events.createdAt))
            .limit(1);
          pending.push({
            publisherId: row.id,
            name: row.name,
            organizerKeys: aliasRows
              .filter((alias) => alias.publisherId === id)
              .map((alias) => alias.key),
            claimedUntil: until,
            sourceId: event?.sourceId ?? null,
            sourceSlug: event?.sourceSlug ?? null,
            title: event?.title ?? null,
            description: event?.description ?? null,
            venueName: event?.venueName ?? null,
            location:
              event?.lat == null || event?.lng == null ? null : { lat: event.lat, lng: event.lng },
            sourceUrl: event?.sourceUrl ?? null,
          });
        }
        return pending;
      });
    },
    async releasePublisherScanClaim(publisherId, claimedUntil) {
      await db
        .update(publishers)
        .set({ scanClaimedUntil: null })
        .where(
          and(
            eq(publishers.id, publisherId),
            eq(publishers.status, 'pending_scan'),
            eq(publishers.scanClaimedUntil, claimedUntil),
          ),
        );
    },
    async finishPublisherScan(input) {
      const lookupSql = input.lookup
        ? sql`jsonb_set(COALESCE(${publishers.meta}, '{}'::jsonb), '{lookup}', ${JSON.stringify(input.lookup)}::jsonb, true)`
        : undefined;
      const updated = await db
        .update(publishers)
        .set({
          status: 'in_review',
          scanClaimedUntil: null,
          ...(lookupSql ? { meta: lookupSql } : {}),
        })
        .where(
          and(
            eq(publishers.id, input.publisherId),
            eq(publishers.status, 'pending_scan'),
            eq(publishers.scanClaimedUntil, input.claimedUntil),
          ),
        )
        .returning({ id: publishers.id });
      return updated.length > 0;
    },
  };
  return store;
}

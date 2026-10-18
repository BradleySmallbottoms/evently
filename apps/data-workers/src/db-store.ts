import type { Db } from '@local-events/db';
import { readEventMeta } from '@local-events/contracts';
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
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { type EventRecord, type PublisherRecord, NEARBY_RADIUS_M, PUBLISHER_NAME_SEARCH_RADIUS_M, publisherNameMatcher, type ImportedEventWrite, type IngestStore, type PendingScanRow, type ScanPublisherCandidate, type NearbyPublisherHit, type NearbyEventHit, NEARBY_RESULT_LIMIT, type PublisherLink } from './store';
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
    startsAt: new Date(input.event.startsAt),
    endsAt: new Date(input.endsAt),
    timezone: input.event.timezone,
    venueName: input.event.venueName ?? null,
    location: input.event.location ? pointEwkt(input.event.location) : null,
    onlineUrl: input.event.onlineUrl ?? null,
    priceAmount: input.event.priceAmount ?? null,
    currency: input.event.currency ?? 'SEK',
    meta: input.event.meta ?? {},
    refId: input.refId,
    workerId: input.workerId,
  };
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
      const slugKeys = [
        ...new Set(nameKeys.flatMap((key) => [key, slugifyPublisherName(key)])),
      ];
      const aliasRows = await db
        .select({
          organizerKey: publisherAliases.externalOrganizerKey,
          sourceId: publisherAliases.sourceId,
          publisherId: publisherAliases.publisherId,
          isTemporary: publishers.isTemporary,
          verified: publishers.verified,
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
              verified: publishers.verified,
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
      const nearIds = new Set<string>();
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
            .select({ publisherId: events.publisherId })
            .from(events)
            .where(
              and(
                inArray(events.publisherId, ids),
                isNotNull(events.location),
                notInArray(events.status, ['cancelled', 'ended']),
                sql`ST_DWithin(${events.location}, ST_GeogFromText(${point}), ${PUBLISHER_NAME_RADIUS_M})`,
              ),
            );
          for (const row of nearby) {
            if (row.publisherId) nearIds.add(row.publisherId);
          }
        }
      }
      const candidates: ScanPublisherCandidate[] = aliasRows.map((row) => ({
        publisherId: row.publisherId,
        sourceId: row.sourceId,
        key: row.organizerKey,
        verified: row.verified,
        createdAt: row.createdAt.getTime(),
        near: nearIds.has(row.publisherId),
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
          verified: publisher.verified,
          createdAt: publisher.createdAt.getTime(),
          near: nearIds.has(publisher.publisherId),
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
        const aliases = await db.select({ key: publisherAliases.externalOrganizerKey }).from(publisherAliases).where(eq(publisherAliases.publisherId, candidate.publisherId));
        result.push({ ...candidate, organizerKeys: aliases.map((alias) => alias.key) });
      }
      console.log('candidates', result);
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
        verified: match.verified,
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
            verified: false,
            origin: 'imported',
            isTemporary: true,
          })
          .returning({ id: publishers.id });
        if (!publisher) throw new Error('Failed to create temporary publisher');
        if (input.organizerKeys.length > 0) {
          await tx.insert(publisherAliases).values(
            input.organizerKeys.map((organizerKey) => ({
              sourceId: input.sourceId,
              externalOrganizerKey: organizerKey,
              publisherId: publisher.id,
            })),
          );
        }
        return {
          publisherId: publisher.id,
          isTemporary: true,
          verified: false,
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
            inArray(publisherAliases.externalOrganizerKey, organizerKeys),
          ),
        );
      const taken = new Set(existing.map((row) => row.organizerKey));
      const fresh = organizerKeys.filter((key) => !taken.has(key));
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
          startsAt: events.startsAt,
          sourceUrl: events.sourceUrl,
          refId: events.refId,
          workerId: events.workerId,
          lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
          lng: sql<number | null>`ST_X(${events.location}::geometry)`,
          distanceM: sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${point}))`,
        })
        .from(events)
        .where(
          and(
            isNotNull(events.location),
            sql`ST_DWithin(${events.location}, ST_GeogFromText(${point}), ${DUPLICATE_RADIUS_M})`,
            gte(events.startsAt, from),
            lte(events.startsAt, to),
            notInArray(events.status, ['cancelled', 'ended']),
          ),
        );
      // console.log('duplicateCandidates: rows = ', rows);
      if (rows.length === 0) {
        // console.log('duplicateCandidates: no rows found');
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
        if (row.lat == null || row.lng == null) return [];
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
        const meta = values.meta.possibleDuplicate
          ? values.meta
          : stored.possibleDuplicate
            ? { ...values.meta, possibleDuplicate: stored.possibleDuplicate }
            : values.meta;
        const updated = await tx
          .update(events)
          .set({
            publisherId: values.publisherId,
            title: values.title,
            description: values.description,
            mode: values.mode,
            sourceUrl: values.sourceUrl,
            startsAt: values.startsAt,
            endsAt: values.endsAt,
            timezone: values.timezone,
            venueName: values.venueName,
            location: values.location,
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
        await writeTags(tx, eventId, input.tagIds);
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
    async claimPendingScans(limit, leaseMs, eventId) {
      const now = new Date();
      const until = new Date(now.getTime() + leaseMs);
      return db.transaction(async (tx) => {
        const ids = await tx
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.status, 'pending_scan'),
              or(isNull(events.scanClaimedUntil), lt(events.scanClaimedUntil, now)),
              ...(eventId ? [eq(events.id, eventId)] : []),
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
            venueName: events.venueName,
            startsAt: events.startsAt,
            endsAt: events.endsAt,
            sourceUrl: events.sourceUrl,
            refId: events.refId,
            workerId: events.workerId,
            meta: events.meta,
            lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
            lng: sql<number | null>`ST_X(${events.location}::geometry)`,
            externalId: externalRefs.externalId,
            sourceId: dataSources.id,
            sourceSlug: dataSources.slug,
            sourceTrust: dataSources.trust,
          })
          .from(events)
          .innerJoin(externalRefs, eq(externalRefs.eventId, events.id))
          .innerJoin(dataSources, eq(dataSources.id, externalRefs.sourceId))
          .where(inArray(events.id, idList));
        const linkRows = await tx
          .select({ eventId: eventLinks.eventId, url: eventLinks.url })
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
          pending.push({
            eventId: row.eventId,
            title: row.title,
            description: row.description,
            venueName: row.venueName,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            location: row.lat == null || row.lng == null ? null : { lat: row.lat, lng: row.lng },
            sourceUrl: row.sourceUrl,
            links: linkRows.filter((link) => link.eventId === id).map((link) => link.url),
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
          await tx.update(events).set({ scanClaimedUntil: null }).where(inArray(events.id, missing));
        }
        return pending;
      });
    },
    async nearbyEvents(
      point: GeoPoint,
      window: NearbyWindow,
      excludeEventId: string,
    ): Promise<NearbyEventHit[]> {
      const { events } = schema;
      const ewkt = pointEwkt(point);
      const rows = await db
        .select({
          id: events.id,
          title: events.title,
          startsAt: events.startsAt,
          venue: events.venueName,
          distanceM: sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`,
        })
        .from(events)
        .where(
          and(
            isNotNull(events.location),
            sql`ST_DWithin(${events.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
            gte(events.startsAt, window.from),
            lte(events.startsAt, window.to),
            notInArray(events.status, ['cancelled', 'ended']),
            ne(events.id, excludeEventId),
          ),
        )
        .orderBy(sql`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`)
        .limit(NEARBY_RESULT_LIMIT);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        startsAt: row.startsAt.toISOString(),
        venue: row.venue,
        distanceM: Math.round(Number(row.distanceM)),
      }));
    },
    async getEvent(eventId: string): Promise<EventRecord | null> {
      const { events } = schema;
      const rows = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      if (!row) return null;
      return {
        eventId: row.id,
        title: row.title,
        startsAt: row.startsAt.toISOString(),
        refId: row.refId,
        workerId: row.workerId,
      };
    },
    async getPublisher(publisherId: string): Promise<PublisherRecord | null> {
      const { publishers, publisherAliases } = schema;
      const rows = await db.select().from(publishers).where(eq(publishers.id, publisherId)).limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      if (!row) return null;
      const aliases = await db.select({
        key: publisherAliases.externalOrganizerKey,
      }).from(publisherAliases).where(eq(publisherAliases.publisherId, publisherId));
      return {
        id: row.id,
        verified: row.verified,
        createdAt: row.createdAt.getTime(),
        isTemporary: row.isTemporary,
        importNotificationPlan: row.importNotificationPlan,
        organizerKeys: aliases.map((alias) => alias.key),
      };
    },
    async nearbyPublishers(
      point: GeoPoint,
      window: NearbyWindow,
      excludeEventId: string,
    ): Promise<NearbyPublisherHit[]> {
      const { events, publishers } = schema;
      const ewkt = pointEwkt(point);
      const distance = sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`;
      const rows = await db
        .selectDistinctOn([publishers.id], {
          id: publishers.id,
          name: publishers.name,
          verified: publishers.verified,
          temporary: publishers.isTemporary,
          nearestEventTitle: events.title,
          distanceM: distance,
        })
        .from(events)
        .innerJoin(publishers, eq(publishers.id, events.publisherId))
        .where(
          and(
            isNotNull(events.location),
            isNotNull(events.publisherId),
            sql`ST_DWithin(${events.location}, ST_GeogFromText(${ewkt}), ${NEARBY_RADIUS_M})`,
            gte(events.startsAt, window.from),
            lte(events.startsAt, window.to),
            notInArray(events.status, ['cancelled', 'ended']),
            ne(events.id, excludeEventId),
          ),
        )
        .orderBy(publishers.id, distance);
      const closest = new Map<string, NearbyPublisherHit>();
      for (const row of rows) {
        const aliases = await db.select({
          key: publisherAliases.externalOrganizerKey,
        }).from(publisherAliases).where(eq(publisherAliases.publisherId, row.id));
        const hit: NearbyPublisherHit = {
          id: row.id,
          name: row.name,
          verified: row.verified,
          temporary: row.temporary,
          nearestEventTitle: row.nearestEventTitle,
          distanceM: Math.round(Number(row.distanceM)),
          organizerKeys: aliases.map((alias) => alias.key),
        };
        const current = closest.get(hit.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(hit.id, hit);
      }
      return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
    },
    /**
     * Publishers whose name matches the wildcard and that have a non-cancelled event
     * within 50 km. Each publisher is returned once, from its closest such event.
     */
    async publishersByName(point, name, excludeEventId) {
      const matcher = publisherNameMatcher(name);
      if ('error' in matcher) return [];
      const { events, publishers } = schema;
      const ewkt = pointEwkt(point);
      const distance = sql<number>`ST_Distance(${events.location}, ST_GeogFromText(${ewkt}))`;
      const rows = await db
        .selectDistinctOn([publishers.id], {
          id: publishers.id,
          name: publishers.name,
          verified: publishers.verified,
          temporary: publishers.isTemporary,
          nearestEventTitle: events.title,
          distanceM: distance,
        })
        .from(events)
        .innerJoin(publishers, eq(publishers.id, events.publisherId))
        .where(
          and(
            isNotNull(events.location),
            isNotNull(events.publisherId),
            sql`ST_DWithin(${events.location}, ST_GeogFromText(${ewkt}), ${PUBLISHER_NAME_SEARCH_RADIUS_M})`,
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
          verified: row.verified,
          temporary: row.temporary,
          nearestEventTitle: row.nearestEventTitle,
          distanceM: Math.round(Number(row.distanceM)),
          organizerKeys: aliases.map((alias) => alias.key),
        };
        const current = closest.get(hit.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(hit.id, hit);
      }
      return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
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
  };
  return store;
}

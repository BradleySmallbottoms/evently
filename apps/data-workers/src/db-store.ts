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
  type PublisherCandidate,
} from '@local-events/domain';
import { and, eq, gte, inArray, isNotNull, lte, notInArray, or, sql } from 'drizzle-orm';
import type { ImportedEventWrite, IngestStore } from './store';

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

  return {
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
    async findPublisher(sourceId, organizerKeys, near) {
      if (organizerKeys.length === 0) return null;
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
          for (const row of nearby) nearIds.add(row.publisherId);
        }
      }
      const candidates: PublisherCandidate[] = aliasRows.map((row) => ({
        publisherId: row.publisherId,
        sourceId: row.sourceId,
        key: row.organizerKey,
        verified: row.verified,
        createdAt: row.createdAt.getTime(),
        near: nearIds.has(row.publisherId),
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
        });
      }
      const chosen = choosePublisher(sourceId, organizerKeys, localSlugs, candidates);
      const match = [...aliasRows, ...namedRows].find((row) => row.publisherId === chosen?.publisherId);
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
    async duplicateCandidates(input) {
      const windowMs = DUPLICATE_WINDOW_MINUTES * 60_000;
      const from = new Date(input.startsAt.getTime() - windowMs);
      const to = new Date(input.startsAt.getTime() + windowMs);
      const point = pointEwkt(input.location);
      console.log('duplicateCandidates: input = ', input);
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
      console.log('duplicateCandidates: rows = ', rows);
      if (rows.length === 0) {
        console.log('duplicateCandidates: no rows found');
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
      await db.transaction(async (tx) => {
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
        await tx
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
            updatedAt: new Date(),
          })
          .where(eq(events.id, eventId));
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
  };
}

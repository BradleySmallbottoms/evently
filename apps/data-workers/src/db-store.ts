import type { Db } from '@local-events/db';
import { insertApprovedEventReminders, pointEwkt, schema } from '@local-events/db';
import {
  IMPORT_NOTIFICATION_AUDIENCE,
  importNotificationMessages,
  pushStatusForEvent,
  slugifyPublisherName,
  tagSlug,
} from '@local-events/domain';
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { ImportedEventWrite, IngestStore, NearbyEvent } from './store';

const NEAR_MS = 30 * 60 * 1000;

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
    eventTags,
    eventImages,
    tags,
    publishers,
    publisherAliases,
    externalRefs,
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
    async findPublisher(sourceId, organizerKey) {
      const [row] = await db
        .select({
          publisherId: publisherAliases.publisherId,
          isTemporary: publishers.isTemporary,
          verified: publishers.verified,
          importNotificationPlan: publishers.importNotificationPlan,
        })
        .from(publisherAliases)
        .innerJoin(publishers, eq(publishers.id, publisherAliases.publisherId))
        .where(
          and(
            eq(publisherAliases.sourceId, sourceId),
            eq(publisherAliases.externalOrganizerKey, organizerKey),
          ),
        )
        .limit(1);
      return row ?? null;
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
        await tx.insert(publisherAliases).values({
          sourceId: input.sourceId,
          externalOrganizerKey: input.organizerKey,
          publisherId: publisher.id,
        });
        return {
          publisherId: publisher.id,
          isTemporary: true,
          verified: false,
          importNotificationPlan: null,
        };
      });
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
    async candidatesNear(startsAt) {
      const from = new Date(startsAt.getTime() - NEAR_MS);
      const to = new Date(startsAt.getTime() + NEAR_MS);
      const rows = await db
        .select({
          eventId: events.id,
          title: events.title,
          startsAt: events.startsAt,
          lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
          lng: sql<number | null>`ST_X(${events.location}::geometry)`,
        })
        .from(events)
        .where(and(gte(events.startsAt, from), lte(events.startsAt, to)))
        .limit(100);
      return rows.map((row): NearbyEvent => ({
        eventId: row.eventId,
        title: row.title,
        startsAt: row.startsAt,
        location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : undefined,
      }));
    },
    async listTags() {
      const rows = await db
        .select({ externalId: schema.tags.externalId, name: schema.tags.name })
        .from(schema.tags)
        .where(isNotNull(schema.tags.externalId));
      return rows.flatMap((row) =>
        row.externalId ? [{ externalId: row.externalId, name: row.name }] : [],
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
    async linkExisting(input) {
      await db.insert(externalRefs).values({
        sourceId: input.sourceId,
        externalId: input.externalId,
        eventId: input.eventId,
        contentHash: input.contentHash,
        lastSeenAt: new Date(),
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

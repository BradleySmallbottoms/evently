import type { Event, PublicEventListQuery, UpdateEventRequest } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { pointEwkt, schema } from '@local-events/db';
import {
  canCancelEvent,
  canEditEvent,
  canPublishAnother,
  canPublishEvent,
  entitlementsFor,
  releaseOnVerification,
  statusOnPublish,
  validateEventFields,
} from '@local-events/domain';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { EventError, type EventEnv, type EventServices } from './types';

type LocRow = {
  id: string;
  publisherId: string;
  title: string;
  description: string | null;
  mode: Event['mode'];
  status: Event['status'];
  origin: Event['origin'];
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  venueName: string | null;
  lat: number | null;
  lng: number | null;
  geofenceRadiusM: number | null;
  onlineUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function assertFields(
  mode: Event['mode'],
  location: Event['location'],
  onlineUrl: Event['onlineUrl'],
) {
  const check = validateEventFields({ mode, location, onlineUrl });
  if (!check.ok) throw new EventError(check.reason);
}

function mapEvent(row: LocRow, categoryIds: string[]): Event {
  return {
    id: row.id,
    publisherId: row.publisherId,
    title: row.title,
    description: row.description,
    mode: row.mode,
    status: row.status,
    origin: row.origin,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    venueName: row.venueName,
    location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    geofenceRadiusM: row.geofenceRadiusM,
    onlineUrl: row.onlineUrl,
    categoryIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const eventSelect = {
  id: schema.events.id,
  publisherId: schema.events.publisherId,
  title: schema.events.title,
  description: schema.events.description,
  mode: schema.events.mode,
  status: schema.events.status,
  origin: schema.events.origin,
  startsAt: schema.events.startsAt,
  endsAt: schema.events.endsAt,
  timezone: schema.events.timezone,
  venueName: schema.events.venueName,
  lat: sql<number | null>`ST_Y(${schema.events.location}::geometry)`,
  lng: sql<number | null>`ST_X(${schema.events.location}::geometry)`,
  geofenceRadiusM: schema.events.geofenceRadiusM,
  onlineUrl: schema.events.onlineUrl,
  createdAt: schema.events.createdAt,
  updatedAt: schema.events.updatedAt,
};

export function createDbEventServices(
  db: Db,
  auth: AuthServices,
  env: EventEnv = { now: () => new Date() },
): EventServices {
  const { events, eventCategories, categories } = schema;

  async function requireMember(sessionToken: string | undefined, publisherId: string) {
    try {
      return await auth.requirePublisherMember(sessionToken, publisherId);
    } catch (err) {
      if (err instanceof AuthError) throw new EventError('unauthorized');
      throw err;
    }
  }

  async function categoryIdsFor(eventId: string): Promise<string[]> {
    const rows = await db
      .select({ categoryId: eventCategories.categoryId })
      .from(eventCategories)
      .where(eq(eventCategories.eventId, eventId));
    return rows.map((r) => r.categoryId);
  }

  async function loadEvent(eventId: string): Promise<Event | null> {
    const [row] = await db.select(eventSelect).from(events).where(eq(events.id, eventId)).limit(1);
    if (!row) return null;
    return mapEvent(row, await categoryIdsFor(eventId));
  }

  async function replaceCategories(eventId: string, categoryIds: string[]) {
    if (categoryIds.length > 0) {
      const found = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, categoryIds));
      if (found.length !== categoryIds.length) throw new EventError('invalid_event');
    }
    await db.delete(eventCategories).where(eq(eventCategories.eventId, eventId));
    if (categoryIds.length > 0) {
      await db.insert(eventCategories).values(
        categoryIds.map((categoryId) => ({ eventId, categoryId })),
      );
    }
  }

  return {
    async listCategories() {
      const rows = await db.select().from(categories);
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        parentId: r.parentId,
        nameSv: r.nameSv,
        nameEn: r.nameEn,
      }));
    },

    async listPublisherEvents({ sessionToken, publisherId }) {
      await requireMember(sessionToken, publisherId);
      const rows = await db
        .select(eventSelect)
        .from(events)
        .where(eq(events.publisherId, publisherId))
        .orderBy(events.startsAt);
      const result: Event[] = [];
      for (const row of rows) {
        result.push(mapEvent(row, await categoryIdsFor(row.id)));
      }
      return result;
    },

    async createEvent({ sessionToken, publisherId, body }) {
      await requireMember(sessionToken, publisherId);
      const location = body.location ?? null;
      const onlineUrl = body.onlineUrl ?? null;
      assertFields(body.mode, location, onlineUrl);

      const now = env.now();
      const [row] = await db
        .insert(events)
        .values({
          publisherId,
          title: body.title,
          description: body.description,
          mode: body.mode,
          status: 'draft',
          origin: 'native',
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          timezone: body.timezone,
          venueName: body.venueName,
          location: location ? pointEwkt(location) : null,
          geofenceRadiusM: body.geofenceRadiusM ?? (body.mode === 'physical' ? 100 : null),
          onlineUrl: onlineUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: events.id });
      if (!row) throw new Error('failed to create event');
      await replaceCategories(row.id, body.categoryIds);
      const created = await loadEvent(row.id);
      if (!created) throw new Error('failed to load event');
      return created;
    },

    async getEvent({ sessionToken, eventId, publicOnly }) {
      const event = await loadEvent(eventId);
      if (!event) throw new EventError('not_found');
      if (publicOnly) {
        if (event.status !== 'published') throw new EventError('not_found');
        return event;
      }
      await requireMember(sessionToken, event.publisherId);
      return event;
    },

    async updateEvent({ sessionToken, eventId, body }: {
      sessionToken: string | undefined;
      eventId: string;
      body: UpdateEventRequest;
    }) {
      const existing = await loadEvent(eventId);
      if (!existing) throw new EventError('not_found');
      await requireMember(sessionToken, existing.publisherId);
      if (!canEditEvent(existing.status)) throw new EventError('cannot_edit');

      const mode = body.mode ?? existing.mode;
      const location =
        body.location !== undefined ? body.location : existing.location;
      const onlineUrl =
        body.onlineUrl !== undefined ? body.onlineUrl : existing.onlineUrl;
      const startsAt = body.startsAt ?? existing.startsAt;
      const endsAt = body.endsAt ?? existing.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) throw new EventError('invalid_event');
      assertFields(mode, location, onlineUrl);

      await db
        .update(events)
        .set({
          title: body.title ?? existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          mode,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          timezone: body.timezone ?? existing.timezone,
          venueName: body.venueName !== undefined ? body.venueName : existing.venueName,
          location: location ? pointEwkt(location) : null,
          geofenceRadiusM:
            body.geofenceRadiusM !== undefined ? body.geofenceRadiusM : existing.geofenceRadiusM,
          onlineUrl,
          updatedAt: env.now(),
        })
        .where(eq(events.id, eventId));

      if (body.categoryIds) await replaceCategories(eventId, body.categoryIds);
      const updated = await loadEvent(eventId);
      if (!updated) throw new EventError('not_found');
      return updated;
    },

    async publishEvent({ sessionToken, eventId }) {
      const existing = await loadEvent(eventId);
      if (!existing) throw new EventError('not_found');
      const access = await requireMember(sessionToken, existing.publisherId);
      if (!canPublishEvent(existing.status)) throw new EventError('cannot_publish');
      assertFields(existing.mode, existing.location, existing.onlineUrl);

      const now = env.now();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.publisherId, existing.publisherId),
            eq(events.status, 'published'),
            gte(events.updatedAt, monthStart),
          ),
        );
      const publishedThisMonth = Number(countRows[0]?.count ?? 0);
      if (!canPublishAnother(entitlementsFor(existing.publisherId), publishedThisMonth)) {
        throw new EventError('limit_reached');
      }

      const status = statusOnPublish({
        origin: 'native',
        publisherVerified: access.publisherVerified,
      });
      await db
        .update(events)
        .set({ status, updatedAt: now })
        .where(eq(events.id, eventId));
      const published = await loadEvent(eventId);
      if (!published) throw new EventError('not_found');
      return published;
    },

    async cancelEvent({ sessionToken, eventId }) {
      const existing = await loadEvent(eventId);
      if (!existing) throw new EventError('not_found');
      await requireMember(sessionToken, existing.publisherId);
      if (!canCancelEvent(existing.status)) throw new EventError('cannot_cancel');
      await db
        .update(events)
        .set({ status: 'cancelled', updatedAt: env.now() })
        .where(eq(events.id, eventId));
      const cancelled = await loadEvent(eventId);
      if (!cancelled) throw new EventError('not_found');
      return cancelled;
    },

    async listPublicEvents(query: PublicEventListQuery) {
      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;
      const point = pointEwkt({ lat: query.lat, lng: query.lng });

      const filters = [eq(events.status, 'published')];
      if (from) filters.push(gte(events.endsAt, from));
      if (to) filters.push(lte(events.startsAt, to));

      // Digital events (no location) always match; physical must be within radius.
      const rows = await db
        .select(eventSelect)
        .from(events)
        .where(
          and(
            ...filters,
            sql`(
              ${events.location} IS NULL
              OR ST_DWithin(
                ${events.location},
                ST_GeogFromText(${point}),
                ${query.radiusM}
              )
            )`,
          ),
        )
        .orderBy(events.startsAt)
        .limit(query.limit);

      const result: Event[] = [];
      for (const row of rows) {
        result.push(mapEvent(row, await categoryIdsFor(row.id)));
      }
      return result;
    },
  };
}

export async function verifyPublisherInDb(
  db: Db,
  publisherId: string,
  now: Date,
): Promise<{ releasedEventCount: number } | null> {
  const [publisher] = await db
    .select({ id: schema.publishers.id, verified: schema.publishers.verified })
    .from(schema.publishers)
    .where(eq(schema.publishers.id, publisherId))
    .limit(1);
  if (!publisher) return null;

  await db
    .update(schema.publishers)
    .set({ verified: true })
    .where(eq(schema.publishers.id, publisherId));

  const awaiting = await db
    .select({
      id: schema.events.id,
      status: schema.events.status,
      endsAt: schema.events.endsAt,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.publisherId, publisherId),
        eq(schema.events.status, 'awaiting_verification'),
      ),
    );

  let releasedEventCount = 0;
  for (const row of awaiting) {
    const next = releaseOnVerification({ status: row.status, endsAt: row.endsAt }, now);
    if (next !== row.status) {
      await db
        .update(schema.events)
        .set({ status: next, updatedAt: now })
        .where(eq(schema.events.id, row.id));
      releasedEventCount += 1;
    }
  }

  return { releasedEventCount };
}

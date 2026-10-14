import type {
  Event,
  EventLink,
  EventLinkInput,
  ManagedEvent,
  PublicEventListQuery,
  UpdateEventRequest,
} from '@local-events/contracts';
import { publicEventTagIds, readEventMeta } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { cancelOpenPushMessages, pointEwkt, schema } from '@local-events/db';
import {
  canCancelEvent,
  canEditEvent,
  canPublishAnother,
  canPublishEvent,
  entitlementsFor,
  publicAssetUrl,
  publicGalleryUrls,
  releaseOnVerification,
  shouldEnqueueNotifications,
  statusOnPublish,
  validateEventFields,
} from '@local-events/domain';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { upsertEventPushDraft } from '../push-messages/drafts';
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
  priceAmount: number | null;
  currency: string;
  meta: unknown;
  publisherName: string;
  featured: boolean;
  checkInEnabled: boolean;
  numSaved: number;
  numComing: number;
  attendeeText: string | null;
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

function mapEvent(
  row: LocRow,
  tagIds: string[],
  imageKey: string | null,
  gallery: readonly { role: string; s3Key: string }[],
  links: EventLink[],
  baseUrl: string | undefined,
): Event {
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
    priceAmount: row.priceAmount,
    currency: row.currency,
    meta: readEventMeta(row.meta),
    publisherName: row.publisherName,
    links,
    imageUrl: publicAssetUrl(baseUrl, imageKey),
    imageUrls: publicGalleryUrls(baseUrl, gallery),
    tagIds,
    featured: row.featured,
    checkInEnabled: row.checkInEnabled,
    numSaved: Number(row.numSaved ?? 0),
    numComing: Number(row.numComing ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type StoredLink = EventLink & { audience: 'public' | 'attendees' };

function publicLinks(links: StoredLink[]): EventLink[] {
  return links
    .filter((link) => link.audience !== 'attendees')
    .map(({ audience: _audience, ...link }) => link);
}

function attendeeLinksOf(links: StoredLink[]): ManagedEvent['attendeeLinks'] {
  return links
    .filter((link) => link.audience === 'attendees')
    .map((link) => ({ id: link.id, url: link.url, label: link.label }));
}

/** Lifetime `stats` value for this event. Missing row is 0. */
function lifetimeStat(key: 'numSaved' | 'numComing') {
  return sql<number>`coalesce((
    select ${schema.stats.value}
    from ${schema.stats}
    where ${schema.stats.sourceType} = 'event'
      and ${schema.stats.sourceId} = ${schema.events.id}
      and ${schema.stats.key} = ${key}
  ), 0)`;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
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
  priceAmount: schema.events.priceAmount,
  currency: schema.events.currency,
  meta: schema.events.meta,
  publisherName: schema.publishers.name,
  featured: schema.events.featured,
  checkInEnabled: schema.events.checkInEnabled,
  numSaved: lifetimeStat('numSaved'),
  numComing: lifetimeStat('numComing'),
  attendeeText: schema.events.attendeeText,
  createdAt: schema.events.createdAt,
  updatedAt: schema.events.updatedAt,
};

export function createDbEventServices(
  db: Db,
  auth: AuthServices,
  env: EventEnv = { now: () => new Date() },
): EventServices {
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const { events, eventTags, eventImages, eventLinks, tags, publishers } = schema;

  function selectEvents() {
    return db
      .select(eventSelect)
      .from(events)
      .innerJoin(publishers, eq(events.publisherId, publishers.id));
  }

  async function requireMember(sessionToken: string | undefined, publisherId: string) {
    try {
      return await auth.requirePublisherMember(sessionToken, publisherId);
    } catch (err) {
      if (err instanceof AuthError) throw new EventError('unauthorized');
      throw err;
    }
  }

  async function tagIdsFor(eventId: string): Promise<string[]> {
    const rows = await db
      .select({ tagId: eventTags.tagId })
      .from(eventTags)
      .where(eq(eventTags.eventId, eventId));
    return rows.map((r) => r.tagId);
  }

  async function imagesFor(eventIds: string[]) {
    const grouped = new Map<
      string,
      { main: string | null; gallery: { role: string; s3Key: string }[] }
    >();
    for (const id of eventIds) grouped.set(id, { main: null, gallery: [] });
    if (eventIds.length === 0) return grouped;
    const rows = await db
      .select({
        eventId: eventImages.eventId,
        role: eventImages.role,
        s3Key: eventImages.s3Key,
      })
      .from(eventImages)
      .where(inArray(eventImages.eventId, eventIds));
    for (const row of rows) {
      const entry = grouped.get(row.eventId) ?? { main: null, gallery: [] };
      if (row.role === 'main') entry.main = row.s3Key;
      entry.gallery.push({ role: row.role, s3Key: row.s3Key });
      grouped.set(row.eventId, entry);
    }
    return grouped;
  }

  function toEvent(
    row: LocRow,
    tagIds: string[],
    images: { main: string | null; gallery: { role: string; s3Key: string }[] },
    links: EventLink[],
  ): Event {
    return mapEvent(row, tagIds, images.main, images.gallery, links, env.assetsPublicBaseUrl);
  }

  async function linksFor(eventIds: string[]): Promise<Map<string, StoredLink[]>> {
    const grouped = new Map<string, StoredLink[]>();
    if (eventIds.length === 0) return grouped;
    const rows = await db
      .select({
        id: eventLinks.id,
        eventId: eventLinks.eventId,
        type: eventLinks.type,
        url: eventLinks.url,
        label: eventLinks.label,
        position: eventLinks.position,
        audience: eventLinks.audience,
      })
      .from(eventLinks)
      .where(inArray(eventLinks.eventId, eventIds))
      .orderBy(asc(eventLinks.position));
    for (const row of rows) {
      const list = grouped.get(row.eventId) ?? [];
      list.push({
        id: row.id,
        type: row.type,
        url: row.url,
        label: row.label,
        position: row.position,
        audience: row.audience,
      });
      grouped.set(row.eventId, list);
    }
    return grouped;
  }

  async function replacePublicLinks(eventId: string, links: EventLinkInput[]) {
    await db
      .delete(eventLinks)
      .where(and(eq(eventLinks.eventId, eventId), eq(eventLinks.audience, 'public')));
    if (links.length === 0) return;
    await db.insert(eventLinks).values(
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

  async function replaceAttendeeLinks(
    eventId: string,
    links: NonNullable<UpdateEventRequest['attendeeLinks']>,
  ) {
    await db
      .delete(eventLinks)
      .where(and(eq(eventLinks.eventId, eventId), eq(eventLinks.audience, 'attendees')));
    if (links.length === 0) return;
    await db.insert(eventLinks).values(
      links.map((link, position) => ({
        eventId,
        type: 'info' as const,
        url: link.url,
        label: link.label ?? null,
        position,
        audience: 'attendees' as const,
      })),
    );
  }

  async function loadEvent(eventId: string): Promise<ManagedEvent | null> {
    const [row] = await selectEvents().where(eq(events.id, eventId)).limit(1);
    if (!row) return null;
    const stored = (await linksFor([eventId])).get(eventId) ?? [];
    const images = (await imagesFor([eventId])).get(eventId) ?? { main: null, gallery: [] };
    return {
      ...toEvent(row, await tagIdsFor(eventId), images, publicLinks(stored)),
      attendeeText: row.attendeeText,
      attendeeLinks: attendeeLinksOf(stored),
    };
  }

  async function replaceTags(eventId: string, tagIds: string[]) {
    if (tagIds.length > 0) {
      const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
      if (found.length !== tagIds.length) throw new EventError('invalid_event');
    }
    await db.delete(eventTags).where(eq(eventTags.eventId, eventId));
    if (tagIds.length > 0) {
      await db.insert(eventTags).values(tagIds.map((tagId) => ({ eventId, tagId })));
    }
  }

  return {
    async listTags(query) {
      const rows = query?.upcoming
        ? await db
            .selectDistinct({ id: tags.id, slug: tags.slug, name: tags.name })
            .from(tags)
            .innerJoin(eventTags, eq(eventTags.tagId, tags.id))
            .innerJoin(events, eq(events.id, eventTags.eventId))
            .where(and(eq(events.status, 'published'), gte(events.endsAt, env.now())))
            .orderBy(asc(tags.slug))
        : await db.select().from(tags).orderBy(asc(tags.slug));
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
      }));
    },

    async listPublisherEvents({ sessionToken, publisherId }) {
      await requireMember(sessionToken, publisherId);
      const rows = await selectEvents()
        .where(eq(events.publisherId, publisherId))
        .orderBy(events.startsAt);
      const ids = rows.map((row) => row.id);
      const [links, images] = await Promise.all([linksFor(ids), imagesFor(ids)]);
      const result: Event[] = [];
      for (const row of rows) {
        result.push(
          toEvent(
            row,
            await tagIdsFor(row.id),
            images.get(row.id) ?? { main: null, gallery: [] },
            publicLinks(links.get(row.id) ?? []),
          ),
        );
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
          priceAmount: body.priceAmount ?? null,
          currency: body.currency,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: events.id });
      if (!row) throw new Error('failed to create event');
      await replaceTags(row.id, body.tagIds);
      await replacePublicLinks(row.id, body.links);
      const created = await loadEvent(row.id);
      if (!created) throw new Error('failed to load event');
      const { attendeeText: _text, attendeeLinks: _links, ...pub } = created;
      return pub;
    },

    async getEvent({ sessionToken, eventId, publicOnly }) {
      const event = await loadEvent(eventId);
      if (!event) throw new EventError('not_found');
      if (publicOnly) {
        if (event.status !== 'published') throw new EventError('not_found');
        const { attendeeText: _text, attendeeLinks: _links, ...pub } = event;
        return pub;
      }
      await requireMember(sessionToken, event.publisherId);
      return event;
    },

    async updateEvent({
      sessionToken,
      eventId,
      body,
    }: {
      sessionToken: string | undefined;
      eventId: string;
      body: UpdateEventRequest;
    }) {
      const existing = await loadEvent(eventId);
      if (!existing) throw new EventError('not_found');
      const access = await requireMember(sessionToken, existing.publisherId);
      if (!canEditEvent(existing.status)) throw new EventError('cannot_edit');

      const mode = body.mode ?? existing.mode;
      const location = body.location !== undefined ? body.location : existing.location;
      const onlineUrl = body.onlineUrl !== undefined ? body.onlineUrl : existing.onlineUrl;
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
          priceAmount: body.priceAmount !== undefined ? body.priceAmount : existing.priceAmount,
          currency: body.currency ?? existing.currency,
          updatedAt: env.now(),
        })
        .where(eq(events.id, eventId));

      if (body.tagIds) await replaceTags(eventId, body.tagIds);
      if (body.attendeeText !== undefined || body.attendeeLinks !== undefined) {
        if (!existing.checkInEnabled) throw new EventError('check_in_disabled');
      }
      if (body.attendeeText !== undefined) {
        await db
          .update(events)
          .set({ attendeeText: body.attendeeText, updatedAt: env.now() })
          .where(eq(events.id, eventId));
      }
      if (body.links) await replacePublicLinks(eventId, body.links);
      if (body.attendeeLinks) await replaceAttendeeLinks(eventId, body.attendeeLinks);
      const updated = await loadEvent(eventId);
      if (!updated) throw new EventError('not_found');
      if (
        updated.status === 'published' ||
        updated.status === 'awaiting_verification' ||
        updated.status === 'in_review'
      ) {
        await upsertEventPushDraft(db, {
          eventId: updated.id,
          eventTitle: updated.title,
          publisherVerified: access.publisherVerified,
          origin: updated.origin,
          now: env.now(),
        });
      }
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
      await db.update(events).set({ status, updatedAt: now }).where(eq(events.id, eventId));
      const published = await loadEvent(eventId);
      if (!published) throw new EventError('not_found');
      await upsertEventPushDraft(db, {
        eventId: published.id,
        eventTitle: published.title,
        publisherVerified: access.publisherVerified,
        origin: 'native',
        now,
      });
      if (shouldEnqueueNotifications(published.status)) {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.published',
          eventId: published.id,
        });
      }
      return published;
    },

    async cancelEvent({ sessionToken, eventId }) {
      const existing = await loadEvent(eventId);
      if (!existing) throw new EventError('not_found');
      await requireMember(sessionToken, existing.publisherId);
      if (!canCancelEvent(existing.status)) throw new EventError('cannot_cancel');
      const now = env.now();
      await db
        .update(events)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(events.id, eventId));
      await cancelOpenPushMessages(db, eventId, now);
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
      if (query.q) {
        const pattern = likePattern(query.q);
        const match = or(
          ilike(events.title, pattern),
          ilike(events.venueName, pattern),
          ilike(publishers.name, pattern),
        );
        if (match) filters.push(match);
      }
      const tagIds = publicEventTagIds(query);
      if (tagIds.length > 0) {
        filters.push(sql`exists (
          select 1 from ${eventTags}
          where ${eventTags.eventId} = ${events.id}
            and ${eventTags.tagId} in (${sql.join(
              tagIds.map((id) => sql`${id}`),
              sql`, `,
            )})
        )`);
      }
      if (query.price === 'free') {
        const free = or(isNull(events.priceAmount), eq(events.priceAmount, 0));
        if (free) filters.push(free);
      }
      if (query.price === 'paid') filters.push(sql`${events.priceAmount} > 0`);

      const engagement = sql<number>`(${lifetimeStat('numSaved')}) + (${lifetimeStat('numComing')})`;
      if (query.sort === 'popular') filters.push(sql`${engagement} >= 1`);
      const distanceOrder =
        query.sort === 'popular'
          ? [desc(engagement), asc(events.startsAt), asc(events.id)]
          : query.sort === 'distance'
            ? [
                desc(events.featured),
                sql`${events.location} IS NULL`,
                sql`ST_Distance(${events.location}, ST_GeogFromText(${point}))`,
                asc(events.startsAt),
                asc(events.id),
              ]
            : [desc(events.featured), asc(events.startsAt), asc(events.id)];

      // isPubliclyListedEvent: a point inside the radius, or tags and no point.
      // Neither is omitted. No point stays off the map.
      const rows = await selectEvents()
        .where(
          and(
            ...filters,
            sql`(
              (
                ${events.location} IS NOT NULL
                AND ST_DWithin(
                  ${events.location},
                  ST_GeogFromText(${point}),
                  ${query.radiusM}
                )
              )
              OR (
                ${events.location} IS NULL
                AND exists (
                  select 1 from ${eventTags}
                  where ${eventTags.eventId} = ${events.id}
                )
              )
            )`,
          ),
        )
        .orderBy(...distanceOrder)
        .limit(query.limit + 1)
        .offset(query.offset);

      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      const ids = pageRows.map((row) => row.id);
      const [links, images] = await Promise.all([linksFor(ids), imagesFor(ids)]);
      const items: Event[] = [];
      for (const row of pageRows) {
        items.push(
          toEvent(
            row,
            await tagIdsFor(row.id),
            images.get(row.id) ?? { main: null, gallery: [] },
            publicLinks(links.get(row.id) ?? []),
          ),
        );
      }
      return { items, nextOffset: hasMore ? query.offset + query.limit : null };
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

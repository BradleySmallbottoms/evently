import type {
  Event,
  EventLink,
  EventLinkInput,
  ManagedEvent,
  OccasionListQuery,
  PublicEventCountQuery,
  PublicEventListQuery,
  UpdateEventRequest,
} from '@local-events/contracts';
import { OCCASION_LIST_LIMIT, publicEventMeta, publicEventTagIds } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { cancelOpenPushMessages, occasionEndsAtSql, pointEwkt, schema } from '@local-events/db';
import {
  canCancelEvent,
  canEditEvent,
  canPublishAnother,
  canPublishEvent,
  entitlementsFor,
  publicAssetUrl,
  publicEventImages,
  releaseOnVerification,
  shouldEnqueueNotifications,
  statusOnPublish,
  validateEventFields,
} from '@local-events/domain';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { upsertEventPushDraft } from '../push-messages/drafts';
import { dbPoint, dbTimestamp } from '../db-values';
import { EventError, type EventEnv, type EventServices } from './types';
import { requirePublisherId } from '../publisher-id';

/** Same rule as domain `eventIsCurrent`, for the public list queries. */
function currentEventSql(now: Date, from?: Date) {
  const { events, eventOccasions } = schema;
  const zone = sql`COALESCE(NULLIF(btrim(${events.timezone}), ''), 'Europe/Stockholm')`;
  const lower = from && from.getTime() > now.getTime() ? from : now;
  // ISO text, not a Date. postgres.js encodes a Date as text when it sits beside
  // AT TIME ZONE, and that throws before the query runs.
  const bound = lower.toISOString();
  const localMidnight = sql`(date_trunc('day', ${bound}::timestamptz AT TIME ZONE ${zone}) AT TIME ZONE ${zone})`;
  return sql`exists (
    select 1
    from ${eventOccasions} eo
    where eo.event_id = ${events.id}
      and (
        eo.ends_at >= ${bound}::timestamptz
        or (eo.starts_at = eo.ends_at and eo.starts_at >= ${localMidnight})
      )
  )`;
}

function nextListOccasionStartSql(now: Date, from?: Date) {
  const { events, eventOccasions } = schema;
  const zone = sql`COALESCE(NULLIF(btrim(${events.timezone}), ''), 'Europe/Stockholm')`;
  const lower = from && from.getTime() > now.getTime() ? from : now;
  const bound = lower.toISOString();
  const localMidnight = sql`(date_trunc('day', ${bound}::timestamptz AT TIME ZONE ${zone}) AT TIME ZONE ${zone})`;
  return sql`(
    select min(eo.starts_at)
    from ${eventOccasions} eo
    where eo.event_id = ${events.id}
      and (
        eo.ends_at >= ${bound}::timestamptz
        or (eo.starts_at = eo.ends_at and eo.starts_at >= ${localMidnight})
      )
  )`;
}

type LocRow = {
  id: string;
  publisherId: string | null;
  title: string;
  summary: string | null;
  description: string | null;
  mode: Event['mode'];
  status: Event['status'];
  origin: Event['origin'];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  timezone: string;
  venueName: string | null;
  lat: number | string | null;
  lng: number | string | null;
  geofenceRadiusM: number | null;
  onlineUrl: string | null;
  priceAmount: number | null;
  currency: string;
  meta: unknown;
  publisherName: string;
  featured: boolean;
  sponsored: boolean;
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

function withDates<T extends { startsAt: Date | string | null; endsAt: Date | string | null }>(
  row: T,
): (T & { startsAt: Date; endsAt: Date }) | null {
  const startsAt = dbTimestamp(row.startsAt);
  const endsAt = dbTimestamp(row.endsAt);
  if (!startsAt || !endsAt) return null;
  return { ...row, startsAt, endsAt };
}

function sameCalendarDay(a: Date, b: Date, timeZone: string): boolean {
  const format = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  try {
    return format(a) === format(b);
  } catch {
    return (
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(a) ===
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(b)
    );
  }
}

function occasionIsCurrentForList(
  occasion: { startsAt: string; endsAt: string },
  now: Date,
  timeZone: string,
  from?: Date,
): boolean {
  const startsAt = new Date(occasion.startsAt);
  const endsAt = new Date(occasion.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return false;
  if (startsAt.getTime() === endsAt.getTime()) {
    if (!sameCalendarDay(startsAt, now, timeZone) && startsAt < now) return false;
    if (from && !sameCalendarDay(startsAt, from, timeZone) && startsAt < from) return false;
    return true;
  }
  const lower = from && from.getTime() > now.getTime() ? from : now;
  return endsAt >= lower;
}

function rowWithListOccasion(
  row: LocRow,
  occasions: {
    id: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
    location: Event['location'];
  }[],
  now: Date,
  from?: Date,
): LocRow {
  const selected = occasions.find((occasion) =>
    occasionIsCurrentForList(occasion, now, row.timezone, from),
  );
  if (!selected) return row;
  const startsAt = new Date(selected.startsAt);
  const endsAt = new Date(selected.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return row;
  return {
    ...row,
    startsAt,
    endsAt,
    venueName: selected.venueName ?? null,
    lat: selected.location?.lat ?? null,
    lng: selected.location?.lng ?? null,
  };
}

function mapEvent(
  row: LocRow & { startsAt: Date; endsAt: Date },
  tagIds: string[],
  imageKey: string | null,
  posterKey: string | null,
  gallery: readonly { role: string; s3Key: string }[],
  links: EventLink[],
  occasions: {
    id: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
    location: Event['location'];
  }[],
  baseUrl: string | undefined,
): Event {
  return {
    id: row.id,
    publisherId: requirePublisherId(row.publisherId),
    title: row.title,
    summary: row.summary,
    description: row.description,
    mode: row.mode,
    status: row.status,
    origin: row.origin,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    venueName: row.venueName,
    location: dbPoint(row.lat, row.lng),
    geofenceRadiusM: row.geofenceRadiusM,
    onlineUrl: row.onlineUrl,
    priceAmount: row.priceAmount,
    currency: row.currency,
    meta: publicEventMeta(row.meta),
    publisherName: row.publisherName,
    links,
    ...publicEventImages(baseUrl, [
      ...(imageKey ? [{ role: 'main', s3Key: imageKey }] : []),
      ...gallery,
    ]),
    posterUrl: publicAssetUrl(baseUrl, posterKey),
    tagIds,
    featured: row.featured,
    sponsored: row.sponsored,
    checkInEnabled: row.checkInEnabled,
    numSaved: Number(row.numSaved ?? 0),
    numComing: Number(row.numComing ?? 0),
    occasions,
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
  summary: schema.events.summary,
  description: schema.events.description,
  mode: schema.events.mode,
  status: schema.events.status,
  origin: schema.events.origin,
  startsAt: sql<Date | null>`(
    select min(${schema.eventOccasions.startsAt})
    from ${schema.eventOccasions}
    where ${schema.eventOccasions.eventId} = ${schema.events.id}
  )`,
  endsAt: sql<Date | null>`(
    select max(${schema.eventOccasions.endsAt})
    from ${schema.eventOccasions}
    where ${schema.eventOccasions.eventId} = ${schema.events.id}
  )`,
  timezone: schema.events.timezone,
  venueName: sql<string | null>`(
    select ${schema.eventOccasions.venueName}
    from ${schema.eventOccasions}
    where ${schema.eventOccasions.eventId} = ${schema.events.id}
    order by ${schema.eventOccasions.startsAt} asc
    limit 1
  )`,
  lat: sql<number | null>`(
    select ST_Y(${schema.eventOccasions.location}::geometry)
    from ${schema.eventOccasions}
    where ${schema.eventOccasions.eventId} = ${schema.events.id}
    order by ${schema.eventOccasions.startsAt} asc
    limit 1
  )`,
  lng: sql<number | null>`(
    select ST_X(${schema.eventOccasions.location}::geometry)
    from ${schema.eventOccasions}
    where ${schema.eventOccasions.eventId} = ${schema.events.id}
    order by ${schema.eventOccasions.startsAt} asc
    limit 1
  )`,
  geofenceRadiusM: schema.events.geofenceRadiusM,
  onlineUrl: schema.events.onlineUrl,
  priceAmount: schema.events.priceAmount,
  currency: schema.events.currency,
  meta: schema.events.meta,
  publisherName: schema.publishers.name,
  featured: schema.events.featured,
  sponsored: schema.events.sponsored,
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
  const { events, eventOccasions, eventTags, eventImages, eventLinks, tags, publishers } = schema;

  function occasionRowsFromInput(
    input: Pick<UpdateEventRequest, 'startsAt' | 'endsAt' | 'venueName' | 'location'> & {
      occasions?: {
        startsAt: string;
        endsAt: string;
        venueName?: string | null;
        location?: Event['location'];
      }[];
    },
  ) {
    if (input.occasions && input.occasions.length > 0) {
      return input.occasions.map((occasion) => ({
        startsAt: new Date(occasion.startsAt),
        endsAt: new Date(occasion.endsAt),
        venueName: occasion.venueName ?? null,
        location: occasion.location ? pointEwkt(occasion.location) : null,
        sourceKey: `${occasion.startsAt}:${occasion.endsAt}`,
      }));
    }
    if (input.startsAt && input.endsAt) {
      return [
        {
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          venueName: input.venueName ?? null,
          location: input.location ? pointEwkt(input.location) : null,
          sourceKey: `${input.startsAt}:${input.endsAt}`,
        },
      ];
    }
    return [];
  }

  function selectEvents() {
    return db
      .select(eventSelect)
      .from(events)
      .innerJoin(publishers, eq(events.publisherId, publishers.id));
  }

  /** Same rows as the public list. `sort=popular` drops events with no saves or coming marks. */
  function publicEventFilters(
    query: PublicEventCountQuery & { sort?: PublicEventListQuery['sort'] },
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const point =
      query.lat != null && query.lng != null ? pointEwkt({ lat: query.lat, lng: query.lng }) : null;
    const radiusM = query.radiusM ?? 50_000;
    const filters = [eq(events.status, 'published'), currentEventSql(env.now(), from)];
    if (to) {
      // ISO text, not a Date. A Date beside AT TIME ZONE in this query makes
      // postgres.js bind it as text and throw before the query runs.
      const until = to.toISOString();
      filters.push(sql`exists (
        select 1 from ${schema.eventOccasions} eo
        where eo.event_id = ${events.id}
          and eo.starts_at <= ${until}::timestamptz
      )`);
    }
    if (query.q) {
      const pattern = likePattern(query.q);
      const match = or(
        ilike(events.title, pattern),
        sql`exists (
          select 1 from ${schema.eventOccasions} eo
          where eo.event_id = ${events.id}
            and eo.venue_name ilike ${pattern}
        )`,
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
    if (query.sort === 'popular') {
      const engagement = sql<number>`(${lifetimeStat('numSaved')}) + (${lifetimeStat('numComing')})`;
      filters.push(sql`${engagement} >= 1`);
    }
    // isPubliclyListedEvent: without near filter, require any point; with near, require a point in range.
    if (point) {
      filters.push(sql`exists (
        select 1
        from ${schema.eventOccasions} eo
        where eo.event_id = ${events.id}
          and eo.location IS NOT NULL
          and ST_DWithin(eo.location, ST_GeogFromText(${point}), ${radiusM})
      )`);
    } else {
      filters.push(sql`exists (
        select 1
        from ${schema.eventOccasions} eo
        where eo.event_id = ${events.id}
          and eo.location IS NOT NULL
      )`);
    }
    return { filters, point };
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
      { main: string | null; poster: string | null; gallery: { role: string; s3Key: string }[] }
    >();
    for (const id of eventIds) grouped.set(id, { main: null, poster: null, gallery: [] });
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
      const entry = grouped.get(row.eventId) ?? { main: null, poster: null, gallery: [] };
      if (row.role === 'main') entry.main = row.s3Key;
      if (row.role === 'poster') entry.poster = row.s3Key;
      entry.gallery.push({ role: row.role, s3Key: row.s3Key });
      grouped.set(row.eventId, entry);
    }
    return grouped;
  }

  async function occasionsFor(eventIds: string[]) {
    const grouped = new Map<
      string,
      {
        id: string;
        startsAt: string;
        endsAt: string;
        venueName: string | null;
        location: Event['location'];
      }[]
    >();
    for (const id of eventIds) grouped.set(id, []);
    if (eventIds.length === 0) return grouped;
    const rows = await db
      .select({
        id: eventOccasions.id,
        eventId: eventOccasions.eventId,
        startsAt: eventOccasions.startsAt,
        endsAt: eventOccasions.endsAt,
        venueName: eventOccasions.venueName,
        lat: sql<number | string | null>`ST_Y(${eventOccasions.location}::geometry)`,
        lng: sql<number | string | null>`ST_X(${eventOccasions.location}::geometry)`,
      })
      .from(eventOccasions)
      .where(inArray(eventOccasions.eventId, eventIds))
      .orderBy(asc(eventOccasions.startsAt), asc(eventOccasions.id));
    for (const row of rows) {
      const startsAt = dbTimestamp(row.startsAt);
      const endsAt = dbTimestamp(row.endsAt);
      if (!startsAt || !endsAt) continue;
      const list = grouped.get(row.eventId) ?? [];
      list.push({
        id: row.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venueName: row.venueName,
        location: dbPoint(row.lat, row.lng),
      });
      grouped.set(row.eventId, list);
    }
    return grouped;
  }

  function toEvent(
    row: LocRow & { startsAt: Date; endsAt: Date },
    tagIds: string[],
    images: {
      main: string | null;
      poster: string | null;
      gallery: { role: string; s3Key: string }[];
    },
    links: EventLink[],
    occasions: {
      id: string;
      startsAt: string;
      endsAt: string;
      venueName: string | null;
      location: Event['location'];
    }[],
  ): Event {
    return mapEvent(
      row,
      tagIds,
      images.main,
      images.poster,
      images.gallery,
      links,
      occasions,
      env.assetsPublicBaseUrl,
    );
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
    const dated = row ? withDates(row) : null;
    if (!dated) return null;
    const stored = (await linksFor([eventId])).get(eventId) ?? [];
    const images = (await imagesFor([eventId])).get(eventId) ?? {
      main: null,
      poster: null,
      gallery: [],
    };
    const occasions = (await occasionsFor([eventId])).get(eventId) ?? [];
    return {
      ...toEvent(dated, await tagIdsFor(eventId), images, publicLinks(stored), occasions),
      attendeeText: dated.attendeeText,
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

  async function replaceOccasions(
    eventId: string,
    input: Pick<UpdateEventRequest, 'startsAt' | 'endsAt' | 'venueName' | 'location'> & {
      occasions?: {
        startsAt: string;
        endsAt: string;
        venueName?: string | null;
        location?: Event['location'];
      }[];
    },
  ) {
    const rows = occasionRowsFromInput(input);
    await db.transaction(async (tx) => {
      await tx.delete(eventOccasions).where(eq(eventOccasions.eventId, eventId));
      if (rows.length === 0) return;
      await tx.insert(eventOccasions).values(rows.map((row) => ({ eventId, ...row })));
    });
  }

  return {
    async listTags(query) {
      const near =
        query?.lat != null && query.lng != null && query.radiusM != null
          ? { lat: query.lat, lng: query.lng, radiusM: query.radiusM }
          : null;
      if (!query?.upcoming && !near) {
        const rows = await db.select().from(tags).orderBy(asc(tags.slug));
        return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
      }
      const filters = [eq(events.status, 'published'), currentEventSql(env.now())];
      if (near) {
        const point = pointEwkt({ lat: near.lat, lng: near.lng });
        filters.push(sql`exists (
          select 1
          from ${eventOccasions} eo
          where eo.event_id = ${events.id}
            and eo.location is not null
            and ST_DWithin(eo.location, ST_GeogFromText(${point}), ${near.radiusM})
        )`);
      }
      const rows = await db
        .selectDistinct({ id: tags.id, slug: tags.slug, name: tags.name })
        .from(tags)
        .innerJoin(eventTags, eq(eventTags.tagId, tags.id))
        .innerJoin(events, eq(events.id, eventTags.eventId))
        .where(and(...filters))
        .orderBy(asc(tags.slug));
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
      }));
    },

    async listPublisherEvents({ sessionToken, publisherId }) {
      await requireMember(sessionToken, publisherId);
      const rows = await selectEvents().where(
        and(eq(events.publisherId, publisherId), ne(events.status, 'deleted')),
      ).orderBy(sql`(
          select min(eo.starts_at) from ${eventOccasions} eo where eo.event_id = ${events.id}
        )`);
      const ids = rows.map((row) => row.id);
      const [links, images, occasions] = await Promise.all([
        linksFor(ids),
        imagesFor(ids),
        occasionsFor(ids),
      ]);
      const result: Event[] = [];
      for (const row of rows) {
        const dated = withDates(row);
        if (!dated) continue;
        result.push(
          toEvent(
            dated,
            await tagIdsFor(row.id),
            images.get(row.id) ?? { main: null, poster: null, gallery: [] },
            publicLinks(links.get(row.id) ?? []),
            occasions.get(row.id) ?? [],
          ),
        );
      }
      return result;
    },

    async createEvent({ sessionToken, publisherId, body }) {
      await requireMember(sessionToken, publisherId);
      const location = body.location ?? null;
      const firstOccasion = body.occasions?.[0];
      const locationForValidation = firstOccasion?.location ?? location;
      const onlineUrl = body.onlineUrl ?? null;
      assertFields(body.mode, locationForValidation, onlineUrl);

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
          timezone: body.timezone,
          geofenceRadiusM: body.geofenceRadiusM ?? (body.mode === 'physical' ? 100 : null),
          onlineUrl: onlineUrl ?? null,
          priceAmount: body.priceAmount ?? null,
          currency: body.currency,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: events.id });
      if (!row) throw new Error('failed to create event');
      await replaceOccasions(row.id, body);
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
      const occasionInput = body.occasions?.[0];
      const locationForValidation = occasionInput?.location ?? location;
      const onlineUrl = body.onlineUrl !== undefined ? body.onlineUrl : existing.onlineUrl;
      const startsAt = body.startsAt ?? existing.startsAt;
      const endsAt = body.endsAt ?? existing.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) throw new EventError('invalid_event');
      assertFields(mode, locationForValidation, onlineUrl);

      await db
        .update(events)
        .set({
          title: body.title ?? existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          mode,
          timezone: body.timezone ?? existing.timezone,
          geofenceRadiusM:
            body.geofenceRadiusM !== undefined ? body.geofenceRadiusM : existing.geofenceRadiusM,
          onlineUrl,
          priceAmount: body.priceAmount !== undefined ? body.priceAmount : existing.priceAmount,
          currency: body.currency ?? existing.currency,
          updatedAt: env.now(),
        })
        .where(eq(events.id, eventId));
      if (body.occasions || (body.startsAt && body.endsAt)) {
        await replaceOccasions(eventId, {
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          venueName: body.venueName,
          location: body.location,
          occasions: body.occasions,
        });
      }

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
          publisherStatus: access.publisherStatus,
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
        publisherStatus: access.publisherStatus,
      });
      await db.update(events).set({ status, updatedAt: now }).where(eq(events.id, eventId));
      const published = await loadEvent(eventId);
      if (!published) throw new EventError('not_found');
      await upsertEventPushDraft(db, {
        eventId: published.id,
        eventTitle: published.title,
        publisherStatus: access.publisherStatus,
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
      const { filters, point } = publicEventFilters(query);
      const from = query.from ? new Date(query.from) : undefined;
      const nextStartOrder = nextListOccasionStartSql(env.now(), from);
      const engagement = sql<number>`(${lifetimeStat('numSaved')}) + (${lifetimeStat('numComing')})`;
      const distanceOrder =
        query.sort === 'popular'
          ? [desc(engagement), nextStartOrder, asc(events.id)]
          : query.sort === 'distance' && point
            ? [
                desc(events.featured),
                sql`(
                  select min(ST_Distance(eo.location, ST_GeogFromText(${point})))
                  from ${eventOccasions} eo
                  where eo.event_id = ${events.id}
                    and eo.location is not null
                )`,
                nextStartOrder,
                asc(events.id),
              ]
            : [desc(events.featured), nextStartOrder, asc(events.id)];

      const rows = await selectEvents()
        .where(and(...filters))
        .orderBy(...distanceOrder)
        .limit(query.limit + 1)
        .offset(query.offset);

      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      const ids = pageRows.map((row) => row.id);
      const [links, images, occasions] = await Promise.all([
        linksFor(ids),
        imagesFor(ids),
        occasionsFor(ids),
      ]);
      const now = env.now();
      const items: Event[] = [];
      for (const row of pageRows) {
        const eventOccasions = occasions.get(row.id) ?? [];
        const listed = rowWithListOccasion(row, eventOccasions, now, from);
        const dated = withDates(listed);
        if (!dated) continue;
        items.push(
          toEvent(
            dated,
            await tagIdsFor(row.id),
            images.get(row.id) ?? { main: null, poster: null, gallery: [] },
            publicLinks(links.get(row.id) ?? []),
            eventOccasions,
          ),
        );
      }
      return { items, nextOffset: hasMore ? query.offset + query.limit : null };
    },

    async countPublicEvents(query) {
      const { filters } = publicEventFilters(query);
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(events)
        .innerJoin(publishers, eq(events.publisherId, publishers.id))
        .where(and(...filters));
      return { total: Number(row?.total ?? 0) };
    },

    async listOccasions(query: OccasionListQuery) {
      const nextStartOrder = nextListOccasionStartSql(env.now());
      const rows = await selectEvents()
        .where(
          and(
            eq(events.status, 'published'),
            currentEventSql(env.now()),
            ...(query.eventId ? [eq(events.id, query.eventId)] : []),
          ),
        )
        .orderBy(nextStartOrder, asc(events.id))
        .limit(OCCASION_LIST_LIMIT);
      const ids = rows.map((row) => row.id);
      const [links, images, occasions] = await Promise.all([
        linksFor(ids),
        imagesFor(ids),
        occasionsFor(ids),
      ]);
      const now = env.now();
      const items: Event[] = [];
      for (const row of rows) {
        const eventOccasions = occasions.get(row.id) ?? [];
        const listed = rowWithListOccasion(row, eventOccasions, now);
        const dated = withDates(listed);
        if (!dated) continue;
        items.push(
          toEvent(
            dated,
            await tagIdsFor(row.id),
            images.get(row.id) ?? { main: null, poster: null, gallery: [] },
            publicLinks(links.get(row.id) ?? []),
            eventOccasions,
          ),
        );
      }
      return items;
    },
  };
}

export async function verifyPublisherInDb(
  db: Db,
  publisherId: string,
  now: Date,
): Promise<{ releasedEventCount: number } | null> {
  const [publisher] = await db
    .select({ id: schema.publishers.id, status: schema.publishers.status })
    .from(schema.publishers)
    .where(eq(schema.publishers.id, publisherId))
    .limit(1);
  if (!publisher) return null;

  await db
    .update(schema.publishers)
    .set({ status: 'published' })
    .where(eq(schema.publishers.id, publisherId));

  const awaiting = await db
    .select({
      id: schema.events.id,
      status: schema.events.status,
      endsAt: occasionEndsAtSql(),
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
    const endsAt = dbTimestamp(row.endsAt);
    if (!endsAt) continue;
    const next = releaseOnVerification({ status: row.status, endsAt }, now);
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

import type { DomainEvent, Event, EventLink, UserEventList } from '@local-events/contracts';
import { publicEventMeta } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  canAddListItem,
  canCreateAnotherList,
  publicAssetUrl,
  publicGalleryUrls,
} from '@local-events/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent, type DomainEventPublisher } from '../domain-events/types';
import { LibraryError, type LibraryServices } from './types';
import { requirePublisherId } from '../publisher-id';

type LocRow = {
  id: string;
  publisherId: string | null;
  title: string;
  description: string | null;
  mode: Event['mode'];
  status: Event['status'];
  origin: Event['origin'];
  startsAt: Date | null;
  endsAt: Date | null;
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
  createdAt: Date;
  updatedAt: Date;
};

function mapRow(
  row: LocRow,
  tagIds: string[],
  imageUrl: string | null,
  imageUrls: string[],
  links: EventLink[],
): Event {
  if (!row.startsAt || !row.endsAt) throw new LibraryError('not_found');
  return {
    id: row.id,
    publisherId: requirePublisherId(row.publisherId),
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
    meta: publicEventMeta(row.meta),
    publisherName: row.publisherName,
    links,
    imageUrl,
    imageUrls,
    tagIds,
    featured: row.featured,
    checkInEnabled: row.checkInEnabled,
    numSaved: Number(row.numSaved ?? 0),
    numComing: Number(row.numComing ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lifetimeStat(key: 'numSaved' | 'numComing') {
  return sql<number>`coalesce((
    select ${schema.stats.value}
    from ${schema.stats}
    where ${schema.stats.sourceType} = 'event'
      and ${schema.stats.sourceId} = ${schema.events.id}
      and ${schema.stats.key} = ${key}
  ), 0)`;
}

export function createDbLibraryServices(
  db: Db,
  auth: AuthServices,
  env: {
    now?: () => Date;
    assetsPublicBaseUrl?: string;
    domainEvents?: DomainEventPublisher;
  } = {},
): LibraryServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const {
    events,
    publishers,
    eventTags,
    eventImages,
    eventLinks,
    savedEvents,
    comingEvents,
    eventLists,
    eventListItems,
  } = schema;

  async function emit(
    type: Extract<
      DomainEvent,
      { type: 'event.saved' | 'event.unsaved' | 'event.coming' | 'event.coming_cleared' }
    >['type'],
    eventId: string,
    userId: string,
  ) {
    await enqueueDomainEvent(domainEvents, { type, eventId, userId });
  }

  async function requireUser(sessionToken: string | undefined) {
    try {
      return await auth.requireUserSession(sessionToken);
    } catch (err) {
      if (err instanceof AuthError) throw new LibraryError('unauthorized');
      throw err;
    }
  }

  const eventSelect = {
    id: events.id,
    publisherId: events.publisherId,
    title: events.title,
    description: events.description,
    mode: events.mode,
    status: events.status,
    origin: events.origin,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
    timezone: events.timezone,
    venueName: events.venueName,
    lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
    lng: sql<number | null>`ST_X(${events.location}::geometry)`,
    geofenceRadiusM: events.geofenceRadiusM,
    onlineUrl: events.onlineUrl,
    priceAmount: events.priceAmount,
    currency: events.currency,
    meta: events.meta,
    publisherName: publishers.name,
    featured: events.featured,
    checkInEnabled: events.checkInEnabled,
    numSaved: lifetimeStat('numSaved'),
    numComing: lifetimeStat('numComing'),
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  };

  async function hydrate(rows: LocRow[]): Promise<Event[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [categories, images, links] = await Promise.all([
      db
        .select({ eventId: eventTags.eventId, tagId: eventTags.tagId })
        .from(eventTags)
        .where(inArray(eventTags.eventId, ids)),
      db
        .select({
          eventId: eventImages.eventId,
          role: eventImages.role,
          s3Key: eventImages.s3Key,
        })
        .from(eventImages)
        .where(inArray(eventImages.eventId, ids)),
      db
        .select()
        .from(eventLinks)
        .where(inArray(eventLinks.eventId, ids))
        .orderBy(asc(eventLinks.position)),
    ]);
    return rows.flatMap((row) => {
      if (!row.startsAt || !row.endsAt) return [];
      const pictures = images.filter((item) => item.eventId === row.id);
      return [
        mapRow(
          row,
          categories.filter((item) => item.eventId === row.id).map((item) => item.tagId),
          publicAssetUrl(
            env.assetsPublicBaseUrl,
            pictures.find((item) => item.role === 'main')?.s3Key ?? null,
          ),
          publicGalleryUrls(env.assetsPublicBaseUrl, pictures),
          links
            .filter((item) => item.eventId === row.id && item.audience !== 'attendees')
            .map((item) => ({
              id: item.id,
              type: item.type,
              url: item.url,
              label: item.label,
              position: item.position,
            })),
        ),
      ];
    });
  }

  async function loadPublished(eventIds: string[]): Promise<Map<string, Event>> {
    if (eventIds.length === 0) return new Map();
    const rows = await db
      .select(eventSelect)
      .from(events)
      .innerJoin(publishers, eq(events.publisherId, publishers.id))
      .where(and(inArray(events.id, eventIds), eq(events.status, 'published')));
    const hydrated = await hydrate(rows);
    return new Map(hydrated.map((event) => [event.id, event]));
  }

  async function requirePublished(eventId: string): Promise<void> {
    const [row] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.status, 'published')))
      .limit(1);
    if (!row) throw new LibraryError('invalid_event');
  }

  async function requireOwnedList(userId: string, listId: string) {
    const [list] = await db
      .select()
      .from(eventLists)
      .where(and(eq(eventLists.id, listId), eq(eventLists.userId, userId)))
      .limit(1);
    if (!list) throw new LibraryError('not_found');
    return list;
  }

  async function toList(list: {
    id: string;
    name: string;
    createdAt: Date;
  }): Promise<UserEventList> {
    const items = await db
      .select({ eventId: eventListItems.eventId })
      .from(eventListItems)
      .where(eq(eventListItems.listId, list.id))
      .orderBy(asc(eventListItems.createdAt));
    const byId = await loadPublished(items.map((item) => item.eventId));
    return {
      id: list.id,
      name: list.name,
      createdAt: list.createdAt.toISOString(),
      events: items.flatMap((item) => {
        const event = byId.get(item.eventId);
        return event ? [event] : [];
      }),
    };
  }

  return {
    async listSaved(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const rows = await db
        .select({ eventId: savedEvents.eventId })
        .from(savedEvents)
        .where(eq(savedEvents.userId, userId))
        .orderBy(desc(savedEvents.createdAt));
      const byId = await loadPublished(rows.map((row) => row.eventId));
      return {
        items: rows.flatMap((row) => {
          const event = byId.get(row.eventId);
          return event ? [event] : [];
        }),
      };
    },

    async saveEvent(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      await requirePublished(eventId);
      const inserted = await db
        .insert(savedEvents)
        .values({ userId, eventId, createdAt: now() })
        .onConflictDoNothing()
        .returning({ eventId: savedEvents.eventId });
      if (inserted.length > 0) await emit('event.saved', eventId, userId);
    },

    async unsaveEvent(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const removed = await db
        .delete(savedEvents)
        .where(and(eq(savedEvents.userId, userId), eq(savedEvents.eventId, eventId)))
        .returning({ eventId: savedEvents.eventId });
      if (removed.length === 0) throw new LibraryError('not_found');
      await emit('event.unsaved', eventId, userId);
    },

    async listComing(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const rows = await db
        .select({ eventId: comingEvents.eventId })
        .from(comingEvents)
        .where(eq(comingEvents.userId, userId))
        .orderBy(desc(comingEvents.createdAt));
      const byId = await loadPublished(rows.map((row) => row.eventId));
      return {
        items: rows.flatMap((row) => {
          const event = byId.get(row.eventId);
          return event ? [event] : [];
        }),
      };
    },

    async markComing(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      await requirePublished(eventId);
      const inserted = await db
        .insert(comingEvents)
        .values({ userId, eventId, createdAt: now() })
        .onConflictDoNothing()
        .returning({ eventId: comingEvents.eventId });
      if (inserted.length > 0) await emit('event.coming', eventId, userId);
    },

    async clearComing(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const removed = await db
        .delete(comingEvents)
        .where(and(eq(comingEvents.userId, userId), eq(comingEvents.eventId, eventId)))
        .returning({ eventId: comingEvents.eventId });
      if (removed.length === 0) throw new LibraryError('not_found');
      await emit('event.coming_cleared', eventId, userId);
    },

    async listLists(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const lists = await db
        .select()
        .from(eventLists)
        .where(eq(eventLists.userId, userId))
        .orderBy(asc(eventLists.createdAt));
      const items: UserEventList[] = [];
      for (const list of lists) items.push(await toList(list));
      return { items };
    },

    async createList(sessionToken, body) {
      const { userId } = await requireUser(sessionToken);
      const owned = await db
        .select({ id: eventLists.id })
        .from(eventLists)
        .where(eq(eventLists.userId, userId));
      if (!canCreateAnotherList(owned.length)) throw new LibraryError('limit_reached');
      const [list] = await db
        .insert(eventLists)
        .values({ userId, name: body.name, createdAt: now() })
        .returning();
      if (!list) throw new Error('failed to create list');
      return toList(list);
    },

    async updateList(sessionToken, listId, body) {
      const { userId } = await requireUser(sessionToken);
      await requireOwnedList(userId, listId);
      const [list] = await db
        .update(eventLists)
        .set({ name: body.name })
        .where(and(eq(eventLists.id, listId), eq(eventLists.userId, userId)))
        .returning();
      if (!list) throw new LibraryError('not_found');
      return toList(list);
    },

    async deleteList(sessionToken, listId) {
      const { userId } = await requireUser(sessionToken);
      const removed = await db
        .delete(eventLists)
        .where(and(eq(eventLists.id, listId), eq(eventLists.userId, userId)))
        .returning({ id: eventLists.id });
      if (removed.length === 0) throw new LibraryError('not_found');
    },

    async addListEvent(sessionToken, listId, eventId) {
      const { userId } = await requireUser(sessionToken);
      await requireOwnedList(userId, listId);
      await requirePublished(eventId);
      const existing = await db
        .select({ eventId: eventListItems.eventId })
        .from(eventListItems)
        .where(eq(eventListItems.listId, listId));
      if (existing.some((item) => item.eventId === eventId)) return;
      if (!canAddListItem(existing.length)) throw new LibraryError('limit_reached');
      await db.insert(eventListItems).values({ listId, eventId, createdAt: now() });
    },

    async removeListEvent(sessionToken, listId, eventId) {
      const { userId } = await requireUser(sessionToken);
      await requireOwnedList(userId, listId);
      const removed = await db
        .delete(eventListItems)
        .where(and(eq(eventListItems.listId, listId), eq(eventListItems.eventId, eventId)))
        .returning({ eventId: eventListItems.eventId });
      if (removed.length === 0) throw new LibraryError('not_found');
    },
  };
}

import {
  OCCASION_LIST_LIMIT,
  publicEventTagIds,
  type CreateEventRequest,
  type Event,
  type EventLink,
  type ManagedEvent,
  type OccasionListQuery,
  type PublicEventCountQuery,
  type PublicEventListQuery,
  type UpdateEventRequest,
} from '@local-events/contracts';
import {
  canCancelEvent,
  canEditEvent,
  canPublishAnother,
  canPublishEvent,
  entitlementsFor,
  eventIsCurrent,
  eventEngagement,
  isPopularEvent,
  isPubliclyListedEvent,
  matchesListPrice,
  releaseOnVerification,
  shouldEnqueueNotifications,
  statusOnPublish,
  validateEventFields,
} from '@local-events/domain';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import {
  createMemoryStore,
  memoryEventEngagement,
  type MemoryEventRow,
  type MemoryStore,
} from '../memory-store';
import { EventError, type EventEnv, type EventServices } from './types';

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toManaged(row: MemoryEventRow, store: MemoryStore): ManagedEvent {
  const { startsAtDate: _starts, endsAtDate: _ends, attendeeText, attendeeLinks, ...event } = row;
  return {
    ...event,
    ...memoryEventEngagement(store, row.id),
    attendeeText: attendeeText ?? null,
    attendeeLinks: (attendeeLinks ?? []).map((link) => ({
      id: link.id,
      url: link.url,
      label: link.label,
    })),
  };
}

function toPublic(row: MemoryEventRow, store: MemoryStore): Event {
  const { attendeeText: _text, attendeeLinks: _links, ...event } = toManaged(row, store);
  return event;
}

function linksFromInput(links: CreateEventRequest['links']): EventLink[] {
  return links.map((link, position) => ({
    id: randomUUID(),
    type: link.type,
    url: link.url,
    label: link.label ?? null,
    position,
  }));
}

function assertFields(
  mode: Event['mode'],
  location: Event['location'],
  onlineUrl: Event['onlineUrl'],
) {
  const check = validateEventFields({ mode, location, onlineUrl });
  if (!check.ok) throw new EventError(check.reason);
}

export function createMemoryEventServices(
  auth: AuthServices,
  env: EventEnv = { now: () => new Date() },
  store: MemoryStore = createMemoryStore(),
): EventServices {
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const { tags, events, publishers } = store;

  async function requireMember(sessionToken: string | undefined, publisherId: string) {
    try {
      return await auth.requirePublisherMember(sessionToken, publisherId);
    } catch (err) {
      if (err instanceof AuthError) throw new EventError('unauthorized');
      throw err;
    }
  }

  function listedPublicEvents(
    query: PublicEventCountQuery & { sort?: PublicEventListQuery['sort'] },
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const center = { lat: query.lat, lng: query.lng };
    const q = query.q?.toLowerCase();
    return [...events.values()]
      .filter((e) => e.status === 'published')
      .filter((e) => isPubliclyListedEvent({ hasLocation: e.location != null }))
      .filter((e) => e.location != null && haversineM(center, e.location) <= query.radiusM)
      .filter((e) =>
        eventIsCurrent({
          startsAt: e.startsAtDate,
          endsAt: e.endsAtDate,
          timeZone: e.timezone,
          now: env.now(),
          from,
        }),
      )
      .filter((e) => !to || e.startsAtDate <= to)
      .filter((e) => {
        const tagIds = publicEventTagIds(query);
        return tagIds.length === 0 || e.tagIds.some((id) => tagIds.includes(id));
      })
      .filter((e) => {
        if (query.price === 'free' || query.price === 'paid') {
          return matchesListPrice(e.priceAmount, query.price);
        }
        return true;
      })
      .filter((e) => {
        if (!q) return true;
        const publisher = publishers.get(e.publisherId)?.name.toLowerCase() ?? '';
        return (
          e.title.toLowerCase().includes(q) ||
          (e.venueName?.toLowerCase().includes(q) ?? false) ||
          publisher.includes(q) ||
          e.publisherName.toLowerCase().includes(q)
        );
      })
      .filter((e) => {
        if (query.sort !== 'popular') return true;
        const counts = memoryEventEngagement(store, e.id);
        return isPopularEvent(counts.numSaved, counts.numComing);
      });
  }

  return {
    async listTags(query) {
      const items = [...tags.values()];
      const near =
        query?.lat != null && query.lng != null && query.radiusM != null
          ? { lat: query.lat, lng: query.lng, radiusM: query.radiusM }
          : null;
      if (!query?.upcoming && !near) return items;
      const now = env.now();
      const active = new Set<string>();
      for (const event of events.values()) {
        if (
          event.status !== 'published' ||
          !eventIsCurrent({
            startsAt: event.startsAtDate,
            endsAt: event.endsAtDate,
            timeZone: event.timezone,
            now,
          })
        ) {
          continue;
        }
        if (near) {
          if (event.location == null || haversineM(near, event.location) > near.radiusM) {
            continue;
          }
        }
        for (const tagId of event.tagIds) active.add(tagId);
      }
      return items.filter((tag) => active.has(tag.id));
    },

    async listPublisherEvents({ sessionToken, publisherId }) {
      await requireMember(sessionToken, publisherId);
      return [...events.values()]
        .filter((e) => e.publisherId === publisherId && e.status !== 'deleted')
        .map((row) => toPublic(row, store))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },

    async createEvent({ sessionToken, publisherId, body }) {
      await requireMember(sessionToken, publisherId);
      const location = body.location ?? null;
      const onlineUrl = body.onlineUrl ?? null;
      assertFields(body.mode, location, onlineUrl);
      for (const id of body.tagIds) {
        if (!tags.has(id)) throw new EventError('invalid_event');
      }
      const now = env.now();
      const id = randomUUID();
      const row: MemoryEventRow = {
        id,
        publisherId,
        title: body.title,
        summary: null,
        description: body.description ?? null,
        mode: body.mode,
        status: 'draft',
        origin: 'native',
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        timezone: body.timezone,
        venueName: body.venueName ?? null,
        location,
        geofenceRadiusM: body.geofenceRadiusM ?? (body.mode === 'physical' ? 100 : null),
        onlineUrl,
        priceAmount: body.priceAmount ?? null,
        currency: body.currency,
        meta: {},
        publisherName: publishers.get(publisherId)?.name ?? '',
        links: linksFromInput(body.links),
        imageUrl: null,
        imageUrls: [],
        tagIds: [...body.tagIds],
        featured: false,
        checkInEnabled: false,
        numSaved: 0,
        numComing: 0,
        attendeeText: null,
        attendeeLinks: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        startsAtDate: new Date(body.startsAt),
        endsAtDate: new Date(body.endsAt),
      };
      events.set(id, row);
      return toPublic(row, store);
    },

    async getEvent({ sessionToken, eventId, publicOnly }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      if (publicOnly) {
        if (row.status !== 'published') throw new EventError('not_found');
        return toPublic(row, store);
      }
      await requireMember(sessionToken, row.publisherId);
      return toManaged(row, store);
    },

    async updateEvent({ sessionToken, eventId, body }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      await requireMember(sessionToken, row.publisherId);
      if (!canEditEvent(row.status)) throw new EventError('cannot_edit');

      if (body.title !== undefined) row.title = body.title;
      if (body.description !== undefined) row.description = body.description;
      if (body.mode !== undefined) row.mode = body.mode;
      if (body.startsAt !== undefined) {
        row.startsAt = body.startsAt;
        row.startsAtDate = new Date(body.startsAt);
      }
      if (body.endsAt !== undefined) {
        row.endsAt = body.endsAt;
        row.endsAtDate = new Date(body.endsAt);
      }
      if (body.timezone !== undefined) row.timezone = body.timezone;
      if (body.venueName !== undefined) row.venueName = body.venueName;
      if (body.location !== undefined) row.location = body.location;
      if (body.geofenceRadiusM !== undefined) row.geofenceRadiusM = body.geofenceRadiusM;
      if (body.onlineUrl !== undefined) row.onlineUrl = body.onlineUrl;
      if (body.priceAmount !== undefined) row.priceAmount = body.priceAmount;
      if (body.currency !== undefined) row.currency = body.currency;
      if (body.links) row.links = linksFromInput(body.links);
      if (body.tagIds !== undefined) {
        for (const id of body.tagIds) {
          if (!tags.has(id)) throw new EventError('invalid_event');
        }
        row.tagIds = [...body.tagIds];
      }
      if (body.attendeeText !== undefined || body.attendeeLinks !== undefined) {
        if (!row.checkInEnabled) throw new EventError('check_in_disabled');
      }
      if (body.attendeeText !== undefined) row.attendeeText = body.attendeeText;
      if (body.attendeeLinks !== undefined) {
        row.attendeeLinks = body.attendeeLinks.map((link, position) => ({
          id: randomUUID(),
          url: link.url,
          label: link.label ?? null,
          position,
        }));
      }
      if (row.endsAtDate <= row.startsAtDate) throw new EventError('invalid_event');
      assertFields(row.mode, row.location, row.onlineUrl);
      row.updatedAt = env.now().toISOString();
      return toManaged(row, store);
    },

    async publishEvent({ sessionToken, eventId }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      const access = await requireMember(sessionToken, row.publisherId);
      if (!canPublishEvent(row.status)) throw new EventError('cannot_publish');
      assertFields(row.mode, row.location, row.onlineUrl);

      const now = env.now();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const publishedThisMonth = [...events.values()].filter(
        (e) =>
          e.publisherId === row.publisherId &&
          e.status === 'published' &&
          new Date(e.updatedAt) >= monthStart,
      ).length;
      if (!canPublishAnother(entitlementsFor(row.publisherId), publishedThisMonth)) {
        throw new EventError('limit_reached');
      }

      row.status = statusOnPublish({
        origin: 'native',
        publisherStatus: access.publisherStatus,
      });
      row.updatedAt = now.toISOString();
      if (shouldEnqueueNotifications(row.status)) {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.published',
          eventId: row.id,
        });
      }
      return toPublic(row, store);
    },

    async cancelEvent({ sessionToken, eventId }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      await requireMember(sessionToken, row.publisherId);
      if (!canCancelEvent(row.status)) throw new EventError('cannot_cancel');
      row.status = 'cancelled';
      row.updatedAt = env.now().toISOString();
      return toPublic(row, store);
    },

    async listPublicEvents(query: PublicEventListQuery) {
      const center = { lat: query.lat, lng: query.lng };
      const matched = listedPublicEvents(query);
      matched.sort((a, b) => {
        if (query.sort === 'popular') {
          const byCount =
            eventEngagement(
              memoryEventEngagement(store, b.id).numSaved,
              memoryEventEngagement(store, b.id).numComing,
            ) -
            eventEngagement(
              memoryEventEngagement(store, a.id).numSaved,
              memoryEventEngagement(store, a.id).numComing,
            );
          if (byCount !== 0) return byCount;
          const byDate = a.startsAt.localeCompare(b.startsAt);
          if (byDate !== 0) return byDate;
          return a.id.localeCompare(b.id);
        }
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (query.sort === 'distance') {
          const da = a.location ? haversineM(center, a.location) : Number.POSITIVE_INFINITY;
          const db = b.location ? haversineM(center, b.location) : Number.POSITIVE_INFINITY;
          if (da !== db) return da - db;
        }
        const byDate = a.startsAt.localeCompare(b.startsAt);
        if (byDate !== 0) return byDate;
        return a.id.localeCompare(b.id);
      });
      const page = matched.slice(query.offset, query.offset + query.limit + 1);
      const hasMore = page.length > query.limit;
      const items = (hasMore ? page.slice(0, query.limit) : page).map((row) =>
        toPublic(row, store),
      );
      return { items, nextOffset: hasMore ? query.offset + query.limit : null };
    },

    async countPublicEvents(query) {
      return { total: listedPublicEvents(query).length };
    },

    async listOccasions(query: OccasionListQuery) {
      const now = env.now();
      return [...events.values()]
        .filter((event) => event.status === 'published')
        .filter((event) =>
          eventIsCurrent({
            startsAt: event.startsAtDate,
            endsAt: event.endsAtDate,
            timeZone: event.timezone,
            now,
          }),
        )
        .filter((event) => event.meta.occasionGroupId === query.occasionGroupId)
        .sort((a, b) => {
          const byDate = a.startsAt.localeCompare(b.startsAt);
          return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
        })
        .slice(0, OCCASION_LIST_LIMIT)
        .map((row) => toPublic(row, store));
    },
  };
}

/** Admin helper used by memory admin services. */
export function releaseAwaitingEventsInStore(
  store: MemoryStore,
  publisherId: string,
  now: Date,
): number {
  let released = 0;
  for (const row of store.events.values()) {
    if (row.publisherId !== publisherId) continue;
    const next = releaseOnVerification({ status: row.status, endsAt: row.endsAtDate }, now);
    if (next !== row.status) {
      row.status = next;
      row.updatedAt = now.toISOString();
      released += 1;
    }
  }
  const publisher = store.publishers.get(publisherId);
  if (publisher) publisher.status = 'published';
  return released;
}

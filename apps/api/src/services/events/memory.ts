import type {
  CreateEventRequest,
  Event,
  PublicEventListQuery,
  UpdateEventRequest,
} from '@local-events/contracts';
import {
  canCancelEvent,
  canEditEvent,
  canPublishAnother,
  canPublishEvent,
  entitlementsFor,
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
import { createMemoryStore, type MemoryEventRow, type MemoryStore } from '../memory-store';
import { EventError, type EventEnv, type EventServices } from './types';

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toEvent(row: MemoryEventRow): Event {
  const { startsAtDate: _s, endsAtDate: _e, ...event } = row;
  return event;
}

function assertFields(mode: Event['mode'], location: Event['location'], onlineUrl: Event['onlineUrl']) {
  const check = validateEventFields({ mode, location, onlineUrl });
  if (!check.ok) throw new EventError(check.reason);
}

export function createMemoryEventServices(
  auth: AuthServices,
  env: EventEnv = { now: () => new Date() },
  store: MemoryStore = createMemoryStore(),
): EventServices {
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const { categories, events, publishers } = store;

  async function requireMember(sessionToken: string | undefined, publisherId: string) {
    try {
      return await auth.requirePublisherMember(sessionToken, publisherId);
    } catch (err) {
      if (err instanceof AuthError) throw new EventError('unauthorized');
      throw err;
    }
  }

  return {
    async listCategories() {
      return [...categories.values()];
    },

    async listPublisherEvents({ sessionToken, publisherId }) {
      await requireMember(sessionToken, publisherId);
      return [...events.values()]
        .filter((e) => e.publisherId === publisherId)
        .map(toEvent)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },

    async createEvent({ sessionToken, publisherId, body }) {
      await requireMember(sessionToken, publisherId);
      const location = body.location ?? null;
      const onlineUrl = body.onlineUrl ?? null;
      assertFields(body.mode, location, onlineUrl);
      for (const id of body.categoryIds) {
        if (!categories.has(id)) throw new EventError('invalid_event');
      }
      const now = env.now();
      const id = randomUUID();
      const row: MemoryEventRow = {
        id,
        publisherId,
        title: body.title,
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
        categoryIds: [...body.categoryIds],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        startsAtDate: new Date(body.startsAt),
        endsAtDate: new Date(body.endsAt),
      };
      events.set(id, row);
      return toEvent(row);
    },

    async getEvent({ sessionToken, eventId, publicOnly }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      if (publicOnly) {
        if (row.status !== 'published') throw new EventError('not_found');
        return toEvent(row);
      }
      await requireMember(sessionToken, row.publisherId);
      return toEvent(row);
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
      if (body.categoryIds !== undefined) {
        for (const id of body.categoryIds) {
          if (!categories.has(id)) throw new EventError('invalid_event');
        }
        row.categoryIds = [...body.categoryIds];
      }
      if (row.endsAtDate <= row.startsAtDate) throw new EventError('invalid_event');
      assertFields(row.mode, row.location, row.onlineUrl);
      row.updatedAt = env.now().toISOString();
      return toEvent(row);
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
        publisherVerified: access.publisherVerified,
      });
      row.updatedAt = now.toISOString();
      if (shouldEnqueueNotifications(row.status)) {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.published',
          eventId: row.id,
        });
      }
      return toEvent(row);
    },

    async cancelEvent({ sessionToken, eventId }) {
      const row = events.get(eventId);
      if (!row) throw new EventError('not_found');
      await requireMember(sessionToken, row.publisherId);
      if (!canCancelEvent(row.status)) throw new EventError('cannot_cancel');
      row.status = 'cancelled';
      row.updatedAt = env.now().toISOString();
      return toEvent(row);
    },

    async listPublicEvents(query: PublicEventListQuery) {
      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;
      const center = { lat: query.lat, lng: query.lng };
      return [...events.values()]
        .filter((e) => e.status === 'published')
        .filter((e) => e.mode === 'digital' || e.location)
        .filter((e) => {
          if (e.mode === 'digital') return true;
          return haversineM(center, e.location!) <= query.radiusM;
        })
        .filter((e) => !from || e.endsAtDate >= from)
        .filter((e) => !to || e.startsAtDate <= to)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .slice(0, query.limit)
        .map(toEvent);
    },
  };
}

/** Admin helper used by memory admin services. */
export function releaseAwaitingEventsInStore(store: MemoryStore, publisherId: string, now: Date): number {
  let released = 0;
  for (const row of store.events.values()) {
    if (row.publisherId !== publisherId) continue;
    const next = releaseOnVerification(
      { status: row.status, endsAt: row.endsAtDate },
      now,
    );
    if (next !== row.status) {
      row.status = next;
      row.updatedAt = now.toISOString();
      released += 1;
    }
  }
  const publisher = store.publishers.get(publisherId);
  if (publisher) publisher.verified = true;
  return released;
}

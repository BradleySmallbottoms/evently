import type { DomainEvent, Event, UserEventList } from '@local-events/contracts';
import { canAddListItem, canCreateAnotherList } from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent, type DomainEventPublisher } from '../domain-events/types';
import {
  createMemoryStore,
  memoryEventEngagement,
  type MemoryEventRow,
  type MemoryStore,
} from '../memory-store';
import { LibraryError, type LibraryServices } from './types';

function asEvent(row: MemoryEventRow, store: MemoryStore): Event {
  const {
    startsAtDate: _starts,
    endsAtDate: _ends,
    attendeeText: _text,
    attendeeLinks: _links,
    ...event
  } = row;
  return { ...event, ...memoryEventEngagement(store, row.id) };
}

export function createMemoryLibraryServices(
  auth: AuthServices,
  store: MemoryStore = createMemoryStore(),
  env: { now?: () => Date; domainEvents?: DomainEventPublisher } = {},
): LibraryServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const { events, savedEvents, comingEvents, eventLists, eventListItems } = store;

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

  function publishedEvent(eventId: string): Event {
    const row = events.get(eventId);
    if (!row || row.status !== 'published') throw new LibraryError('invalid_event');
    return asEvent(row, store);
  }

  function requireList(userId: string, listId: string) {
    const list = eventLists.find((item) => item.id === listId && item.userId === userId);
    if (!list) throw new LibraryError('not_found');
    return list;
  }

  function toList(list: (typeof eventLists)[number]): UserEventList {
    const items = eventListItems
      .filter((item) => item.listId === list.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
      id: list.id,
      name: list.name,
      createdAt: list.createdAt.toISOString(),
      events: items.flatMap((item) => {
        const row = events.get(item.eventId);
        return row && row.status === 'published' ? [asEvent(row, store)] : [];
      }),
    };
  }

  return {
    async listSaved(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const items = savedEvents
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .flatMap((row) => {
          const event = events.get(row.eventId);
          return event && event.status === 'published' ? [asEvent(event, store)] : [];
        });
      return { items };
    },

    async saveEvent(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      publishedEvent(eventId);
      if (savedEvents.some((row) => row.userId === userId && row.eventId === eventId)) return;
      savedEvents.push({ userId, eventId, createdAt: now() });
      await emit('event.saved', eventId, userId);
    },

    async unsaveEvent(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const index = savedEvents.findIndex(
        (row) => row.userId === userId && row.eventId === eventId,
      );
      if (index < 0) throw new LibraryError('not_found');
      savedEvents.splice(index, 1);
      await emit('event.unsaved', eventId, userId);
    },

    async listComing(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const items = comingEvents
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .flatMap((row) => {
          const event = events.get(row.eventId);
          return event && event.status === 'published' ? [asEvent(event, store)] : [];
        });
      return { items };
    },

    async markComing(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      publishedEvent(eventId);
      if (comingEvents.some((row) => row.userId === userId && row.eventId === eventId)) return;
      comingEvents.push({ userId, eventId, createdAt: now() });
      await emit('event.coming', eventId, userId);
    },

    async clearComing(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const index = comingEvents.findIndex(
        (row) => row.userId === userId && row.eventId === eventId,
      );
      if (index < 0) throw new LibraryError('not_found');
      comingEvents.splice(index, 1);
      await emit('event.coming_cleared', eventId, userId);
    },

    async listLists(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const items = eventLists
        .filter((list) => list.userId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(toList);
      return { items };
    },

    async createList(sessionToken, body) {
      const { userId } = await requireUser(sessionToken);
      const owned = eventLists.filter((list) => list.userId === userId).length;
      if (!canCreateAnotherList(owned)) throw new LibraryError('limit_reached');
      const list = { id: randomUUID(), userId, name: body.name, createdAt: now() };
      eventLists.push(list);
      return toList(list);
    },

    async updateList(sessionToken, listId, body) {
      const { userId } = await requireUser(sessionToken);
      const list = requireList(userId, listId);
      list.name = body.name;
      return toList(list);
    },

    async deleteList(sessionToken, listId) {
      const { userId } = await requireUser(sessionToken);
      const index = eventLists.findIndex((list) => list.id === listId && list.userId === userId);
      if (index < 0) throw new LibraryError('not_found');
      eventLists.splice(index, 1);
      for (let i = eventListItems.length - 1; i >= 0; i -= 1) {
        if (eventListItems[i]?.listId === listId) eventListItems.splice(i, 1);
      }
    },

    async addListEvent(sessionToken, listId, eventId) {
      const { userId } = await requireUser(sessionToken);
      requireList(userId, listId);
      publishedEvent(eventId);
      if (eventListItems.some((item) => item.listId === listId && item.eventId === eventId)) return;
      const count = eventListItems.filter((item) => item.listId === listId).length;
      if (!canAddListItem(count)) throw new LibraryError('limit_reached');
      eventListItems.push({ listId, eventId, createdAt: now() });
    },

    async removeListEvent(sessionToken, listId, eventId) {
      const { userId } = await requireUser(sessionToken);
      requireList(userId, listId);
      const index = eventListItems.findIndex(
        (item) => item.listId === listId && item.eventId === eventId,
      );
      if (index < 0) throw new LibraryError('not_found');
      eventListItems.splice(index, 1);
    },
  };
}

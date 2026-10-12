import type { CreateEventPushMessageRequest } from '@local-events/contracts';
import type { PushMessageRow } from '@local-events/db';
import {
  defaultPushMessageCopy,
  initialPushMessageStatus,
  shouldAutoApprovePushMessage,
} from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { EventError } from '../events/types';
import type { MemoryStore } from '../memory-store';
import type { PublisherPushMessageServices } from './publisher';

export function createMemoryPublisherPushMessageServices(
  auth: AuthServices,
  store: MemoryStore,
): PublisherPushMessageServices {
  if (!store.pushMessages) store.pushMessages = new Map();

  return {
    async getOpen({ sessionToken, eventId }) {
      const event = store.events.get(eventId);
      if (!event) throw new EventError('not_found');
      try {
        await auth.requirePublisherMember(sessionToken, event.publisherId);
      } catch (err) {
        if (err instanceof AuthError) throw new EventError('unauthorized');
        throw err;
      }
      for (const row of store.pushMessages!.values()) {
        if (
          row.eventId === eventId &&
          ['pending', 'approved', 'sending', 'rejected'].includes(row.status)
        ) {
          return row;
        }
      }
      return null;
    },

    async create({ sessionToken, eventId, body }) {
      const event = store.events.get(eventId);
      if (!event) throw new EventError('not_found');
      let verified = false;
      try {
        const access = await auth.requirePublisherMember(sessionToken, event.publisherId);
        verified = access.publisherVerified;
      } catch (err) {
        if (err instanceof AuthError) throw new EventError('unauthorized');
        throw err;
      }
      for (const row of store.pushMessages!.values()) {
        if (
          row.eventId === eventId &&
          ['pending', 'approved', 'sending', 'rejected'].includes(row.status)
        ) {
          throw new EventError('invalid_event');
        }
      }
      const defaults = defaultPushMessageCopy(event.title);
      const status = initialPushMessageStatus(
        shouldAutoApprovePushMessage({
          publisherVerified: verified,
          origin: event.origin,
        }),
      );
      const now = new Date();
      const row: PushMessageRow = {
        id: randomUUID(),
        eventId,
        status,
        titleSv: body.titleSv ?? defaults.titleSv,
        bodySv: body.bodySv ?? defaults.bodySv,
        titleEn: body.titleEn ?? defaults.titleEn,
        bodyEn: body.bodyEn ?? defaults.bodyEn,
        sendAt: body.sendAt ? new Date(body.sendAt) : null,
        copyEdited: Boolean(body.titleSv || body.bodySv || body.titleEn || body.bodyEn),
        approvedAt: status === 'approved' ? now : null,
        approvedByAdminId: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.pushMessages!.set(row.id, row);
      return row;
    },
  };
}

/** No-op factory when only createApp defaults are needed without a shared store. */
export function createEmptyPublisherPushMessageServices(): PublisherPushMessageServices {
  return {
    async getOpen() {
      return null;
    },
    async create() {
      throw new EventError('not_found');
    },
  };
}

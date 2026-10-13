import type { CreateEventPushMessageRequest, SentEventNotification } from '@local-events/contracts';
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

    async listSent({ sessionToken, eventId }) {
      const event = store.events.get(eventId);
      if (!event) throw new EventError('not_found');
      try {
        await auth.requirePublisherMember(sessionToken, event.publisherId);
      } catch (err) {
        if (err instanceof AuthError) throw new EventError('unauthorized');
        throw err;
      }
      const messages = store.pushMessages ?? new Map();
      return [...messages.values()]
        .filter(
          (row) =>
            row.eventId === eventId && (row.status === 'sent' || row.status === 'sending'),
        )
        .map((row) => sentFromRow(row, store))
        .sort(compareSentDesc);
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
        kind: 'event',
        audience: 'event_match',
        audienceTagId: null,
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

function sentFromRow(
  row: PushMessageRow,
  store: MemoryStore,
): SentEventNotification {
  const users = new Set(
    [...store.notifications.values()]
      .filter((notification) => notification.pushMessageId === row.id)
      .map((notification) => notification.userId),
  );
  return {
    id: row.id,
    status: row.status === 'sending' ? 'sending' : 'sent',
    audience: row.audience,
    audienceTagName: null,
    titleSv: row.titleSv,
    bodySv: row.bodySv,
    titleEn: row.titleEn,
    bodyEn: row.bodyEn,
    sendAt: row.sendAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    recipientCount: users.size,
  };
}

/** Matches Postgres `ORDER BY sent_at DESC` (nulls first), then created_at DESC. */
function compareSentDesc(a: SentEventNotification, b: SentEventNotification): number {
  if (a.sentAt == null && b.sentAt != null) return -1;
  if (b.sentAt == null && a.sentAt != null) return 1;
  if (a.sentAt != null && b.sentAt != null && a.sentAt !== b.sentAt) {
    return b.sentAt.localeCompare(a.sentAt);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** No-op factory when only createApp defaults are needed without a shared store. */
export function createEmptyPublisherPushMessageServices(): PublisherPushMessageServices {
  return {
    async getOpen() {
      return null;
    },
    async listSent() {
      throw new EventError('unauthorized');
    },
    async create() {
      throw new EventError('not_found');
    },
  };
}

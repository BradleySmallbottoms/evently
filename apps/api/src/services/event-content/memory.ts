import type {
  CreateEventContentRequest,
  EventContentItem,
  UpdateEventContentRequest,
} from '@local-events/contracts';
import { canViewEventContent } from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryStore, type MemoryEventContent, type MemoryStore } from '../memory-store';
import { createMemoryContentUrlSigner } from './signer';
import { EventContentError, type EventContentEnv, type EventContentServices } from './types';

export type { MemoryEventContent };

export function createMemoryEventContentServices(
  auth: AuthServices,
  env: EventContentEnv = {},
  store: MemoryStore = createMemoryStore(),
): EventContentServices {
  const now = env.now ?? (() => new Date());
  const signer = env.signer ?? createMemoryContentUrlSigner(now);
  const rows = store.eventContent;
  const checkIns = store.checkIns;

  async function toItem(row: MemoryEventContent, includeUrl: boolean): Promise<EventContentItem> {
    let url: string | null = null;
    let urlExpiresAt: string | null = null;
    if (includeUrl && row.s3Key) {
      const signed = await signer.sign(row.s3Key);
      url = signed.url;
      urlExpiresAt = signed.expiresAt.toISOString();
    }
    return {
      id: row.id,
      eventId: row.eventId,
      kind: row.kind,
      title: row.title,
      body: row.body,
      visibility: row.visibility,
      url,
      urlExpiresAt,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async function requirePublisher(eventId: string, token: string | undefined) {
    const event = store.events.get(eventId);
    if (!event) throw new EventContentError('not_found');
    try {
      await auth.requirePublisherMember(token, event.publisherId);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new EventContentError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
      }
      throw err;
    }
    return event;
  }

  return {
    async listForEvent(sessionToken, eventId) {
      const event = store.events.get(eventId);
      if (!event || event.status !== 'published') throw new EventContentError('not_found');

      let checkedIn = false;
      if (sessionToken) {
        try {
          const { userId } = await auth.requireUserSession(sessionToken);
          checkedIn = checkIns.some((c) => c.userId === userId && c.eventId === eventId);
        } catch (err) {
          if (!(err instanceof AuthError)) throw err;
        }
      }

      const visible = rows.filter(
        (r) => r.eventId === eventId && canViewEventContent(r.visibility, checkedIn),
      );
      const items = await Promise.all(visible.map((r) => toItem(r, true)));
      const unlocked = checkedIn && event.checkInEnabled;
      return {
        items,
        checkedIn,
        attendeeText: unlocked ? (event.attendeeText ?? null) : null,
        attendeeLinks: unlocked
          ? (event.attendeeLinks ?? []).map((link) => ({
              id: link.id,
              url: link.url,
              label: link.label,
            }))
          : [],
      };
    },

    async listManaged(publisherSessionToken, eventId) {
      await requirePublisher(eventId, publisherSessionToken);
      const items = await Promise.all(
        rows.filter((r) => r.eventId === eventId).map((r) => toItem(r, true)),
      );
      return { items };
    },

    async create(publisherSessionToken, eventId, input: CreateEventContentRequest) {
      await requirePublisher(eventId, publisherSessionToken);
      const row: MemoryEventContent = {
        id: randomUUID(),
        eventId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        s3Key: input.s3Key ?? null,
        visibility: input.visibility ?? 'attendees',
        createdAt: now(),
      };
      rows.push(row);
      return toItem(row, true);
    },

    async update(publisherSessionToken, contentId, input: UpdateEventContentRequest) {
      const row = rows.find((r) => r.id === contentId);
      if (!row) throw new EventContentError('not_found');
      await requirePublisher(row.eventId, publisherSessionToken);
      if (input.kind !== undefined) row.kind = input.kind;
      if (input.title !== undefined) row.title = input.title;
      if (input.body !== undefined) row.body = input.body;
      if (input.s3Key !== undefined) row.s3Key = input.s3Key;
      if (input.visibility !== undefined) row.visibility = input.visibility;
      return toItem(row, true);
    },

    async remove(publisherSessionToken, contentId) {
      const idx = rows.findIndex((r) => r.id === contentId);
      if (idx < 0) throw new EventContentError('not_found');
      await requirePublisher(rows[idx]!.eventId, publisherSessionToken);
      rows.splice(idx, 1);
    },
  };
}

import type { CreateEventPushMessageRequest } from '@local-events/contracts';
import {
  findOpenPushMessage,
  type Db,
  type PushMessageRow,
} from '@local-events/db';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { EventError } from '../events/types';
import { createEventPushDraft } from './drafts';
import { schema } from '@local-events/db';
import { eq } from 'drizzle-orm';

export type PublisherPushMessageServices = {
  getOpen: (input: {
    sessionToken: string | undefined;
    eventId: string;
  }) => Promise<PushMessageRow | null>;
  create: (input: {
    sessionToken: string | undefined;
    eventId: string;
    body: CreateEventPushMessageRequest;
  }) => Promise<PushMessageRow>;
};

export function createDbPublisherPushMessageServices(
  db: Db,
  auth: AuthServices,
): PublisherPushMessageServices {
  async function requireEventMember(sessionToken: string | undefined, eventId: string) {
    const [event] = await db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        publisherId: schema.events.publisherId,
        origin: schema.events.origin,
        status: schema.events.status,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event) throw new EventError('not_found');
    try {
      const access = await auth.requirePublisherMember(sessionToken, event.publisherId);
      return { event, access };
    } catch (err) {
      if (err instanceof AuthError) throw new EventError('unauthorized');
      throw err;
    }
  }

  return {
    async getOpen({ sessionToken, eventId }) {
      await requireEventMember(sessionToken, eventId);
      return findOpenPushMessage(db, eventId);
    },

    async create({ sessionToken, eventId, body }) {
      const { event, access } = await requireEventMember(sessionToken, eventId);
      if (
        event.status !== 'published' &&
        event.status !== 'awaiting_verification' &&
        event.status !== 'in_review'
      ) {
        throw new EventError('cannot_publish');
      }
      try {
        return await createEventPushDraft(db, {
          eventId,
          eventTitle: event.title,
          publisherVerified: access.publisherVerified,
          origin: event.origin,
          copyOverride:
            body.titleSv || body.bodySv || body.titleEn || body.bodyEn
              ? {
                  titleSv: body.titleSv,
                  bodySv: body.bodySv,
                  titleEn: body.titleEn,
                  bodyEn: body.bodyEn,
                }
              : undefined,
          sendAt: body.sendAt === undefined ? undefined : body.sendAt ? new Date(body.sendAt) : null,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'push_draft_exists') {
          throw new EventError('invalid_event');
        }
        throw err;
      }
    },
  };
}

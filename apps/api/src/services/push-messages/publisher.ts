import type {
  CreateEventPushMessageRequest,
  SentEventNotification,
} from '@local-events/contracts';
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
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

export type PublisherPushMessageServices = {
  getOpen: (input: {
    sessionToken: string | undefined;
    eventId: string;
  }) => Promise<PushMessageRow | null>;
  listSent: (input: {
    sessionToken: string | undefined;
    eventId: string;
  }) => Promise<SentEventNotification[]>;
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

    async listSent({ sessionToken, eventId }) {
      await requireEventMember(sessionToken, eventId);
      const rows = await db
        .select({
          id: schema.pushMessages.id,
          audience: schema.pushMessages.audience,
          audienceTagName: schema.tags.name,
          status: schema.pushMessages.status,
          titleSv: schema.pushMessages.titleSv,
          bodySv: schema.pushMessages.bodySv,
          titleEn: schema.pushMessages.titleEn,
          bodyEn: schema.pushMessages.bodyEn,
          sendAt: schema.pushMessages.sendAt,
          sentAt: schema.pushMessages.sentAt,
          createdAt: schema.pushMessages.createdAt,
        })
        .from(schema.pushMessages)
        .leftJoin(schema.tags, eq(schema.tags.id, schema.pushMessages.audienceTagId))
        .where(
          and(
            eq(schema.pushMessages.eventId, eventId),
            inArray(schema.pushMessages.status, ['sent', 'sending']),
          ),
        )
        .orderBy(desc(schema.pushMessages.sentAt), desc(schema.pushMessages.createdAt));
      const counts = new Map<string, number>();
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        const counted = await db
          .select({
            pushMessageId: schema.notifications.pushMessageId,
            count: sql<number>`count(distinct ${schema.notifications.userId})::int`,
          })
          .from(schema.notifications)
          .where(inArray(schema.notifications.pushMessageId, ids))
          .groupBy(schema.notifications.pushMessageId);
        for (const row of counted) {
          if (row.pushMessageId) counts.set(row.pushMessageId, Number(row.count));
        }
      }
      return rows.flatMap((row) => {
        if (row.status !== 'sent' && row.status !== 'sending') return [];
        return [
          {
            id: row.id,
            status: row.status,
            audience: row.audience,
            audienceTagName: row.audienceTagName,
            titleSv: row.titleSv,
            bodySv: row.bodySv,
            titleEn: row.titleEn,
            bodyEn: row.bodyEn,
            sendAt: row.sendAt?.toISOString() ?? null,
            sentAt: row.sentAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            recipientCount: counts.get(row.id) ?? 0,
          },
        ];
      });
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

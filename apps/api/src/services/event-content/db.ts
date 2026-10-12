import type {
  CreateEventContentRequest,
  EventContentItem,
  UpdateEventContentRequest,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { canViewEventContent } from '@local-events/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryContentUrlSigner } from './signer';
import {
  EventContentError,
  type EventContentEnv,
  type EventContentServices,
} from './types';

export function createDbEventContentServices(
  db: Db,
  auth: AuthServices,
  env: EventContentEnv = {},
): EventContentServices {
  const now = env.now ?? (() => new Date());
  const signer = env.signer ?? createMemoryContentUrlSigner(now);

  async function toItem(
    row: {
      id: string;
      eventId: string;
      kind: 'map' | 'schedule' | 'info' | 'file';
      title: string;
      body: string | null;
      s3Key: string | null;
      visibility: 'public' | 'attendees';
      createdAt: Date;
    },
    includeUrl: boolean,
  ): Promise<EventContentItem> {
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

  async function loadEvent(eventId: string) {
    const [row] = await db
      .select({
        id: schema.events.id,
        publisherId: schema.events.publisherId,
        status: schema.events.status,
        checkInEnabled: schema.events.checkInEnabled,
        attendeeText: schema.events.attendeeText,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row) throw new EventContentError('not_found');
    return row;
  }

  async function requirePublisher(eventId: string, token: string | undefined) {
    const event = await loadEvent(eventId);
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
      const event = await loadEvent(eventId);
      if (event.status !== 'published') throw new EventContentError('not_found');

      let checkedIn = false;
      if (sessionToken) {
        try {
          const { userId } = await auth.requireUserSession(sessionToken);
          const [existing] = await db
            .select({ id: schema.checkIns.id })
            .from(schema.checkIns)
            .where(
              and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
            )
            .limit(1);
          checkedIn = Boolean(existing);
        } catch (err) {
          if (!(err instanceof AuthError)) throw err;
        }
      }

      const rows = await db
        .select()
        .from(schema.eventContent)
        .where(eq(schema.eventContent.eventId, eventId));
      const visible = rows.filter((r) => canViewEventContent(r.visibility, checkedIn));
      const items = await Promise.all(visible.map((r) => toItem(r, true)));
      const attendeeLinks =
        checkedIn && event.checkInEnabled
          ? await db
              .select({
                id: schema.eventLinks.id,
                url: schema.eventLinks.url,
                label: schema.eventLinks.label,
              })
              .from(schema.eventLinks)
              .where(
                and(
                  eq(schema.eventLinks.eventId, eventId),
                  eq(schema.eventLinks.audience, 'attendees'),
                ),
              )
              .orderBy(asc(schema.eventLinks.position))
          : [];
      return {
        items,
        checkedIn,
        attendeeText: checkedIn && event.checkInEnabled ? event.attendeeText : null,
        attendeeLinks,
      };
    },

    async listManaged(publisherSessionToken, eventId) {
      await requirePublisher(eventId, publisherSessionToken);
      const rows = await db
        .select()
        .from(schema.eventContent)
        .where(eq(schema.eventContent.eventId, eventId));
      return { items: await Promise.all(rows.map((r) => toItem(r, true))) };
    },

    async create(publisherSessionToken, eventId, input: CreateEventContentRequest) {
      await requirePublisher(eventId, publisherSessionToken);
      const [row] = await db
        .insert(schema.eventContent)
        .values({
          eventId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          s3Key: input.s3Key ?? null,
          visibility: input.visibility ?? 'attendees',
          createdAt: now(),
        })
        .returning();
      if (!row) throw new EventContentError('not_found');
      return toItem(row, true);
    },

    async update(publisherSessionToken, contentId, input: UpdateEventContentRequest) {
      const [existing] = await db
        .select()
        .from(schema.eventContent)
        .where(eq(schema.eventContent.id, contentId))
        .limit(1);
      if (!existing) throw new EventContentError('not_found');
      await requirePublisher(existing.eventId, publisherSessionToken);
      const [row] = await db
        .update(schema.eventContent)
        .set({
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.s3Key !== undefined ? { s3Key: input.s3Key } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        })
        .where(eq(schema.eventContent.id, contentId))
        .returning();
      if (!row) throw new EventContentError('not_found');
      return toItem(row, true);
    },

    async remove(publisherSessionToken, contentId) {
      const [existing] = await db
        .select()
        .from(schema.eventContent)
        .where(eq(schema.eventContent.id, contentId))
        .limit(1);
      if (!existing) throw new EventContentError('not_found');
      await requirePublisher(existing.eventId, publisherSessionToken);
      await db.delete(schema.eventContent).where(eq(schema.eventContent.id, contentId));
    },
  };
}

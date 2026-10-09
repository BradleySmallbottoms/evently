import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { desc, eq } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import type { NotificationServices } from './types';

export function createDbNotificationServices(
  db: Db,
  auth: AuthServices,
): NotificationServices {
  const { notifications, events } = schema;

  return {
    async listNotifications(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const rows = await db
        .select({
          id: notifications.id,
          eventId: notifications.eventId,
          eventTitle: events.title,
          reason: notifications.reason,
          pushState: notifications.pushState,
          createdAt: notifications.sentAt,
          pushedAt: notifications.pushedAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .innerJoin(events, eq(events.id, notifications.eventId))
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.sentAt))
        .limit(100);

      return {
        items: rows.map((r) => ({
          id: r.id,
          eventId: r.eventId,
          eventTitle: r.eventTitle,
          reason: r.reason,
          pushState: r.pushState,
          createdAt: r.createdAt.toISOString(),
          pushedAt: r.pushedAt?.toISOString() ?? null,
          readAt: r.readAt?.toISOString() ?? null,
        })),
      };
    },
  };
}

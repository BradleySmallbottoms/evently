import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import type { NotificationServices } from './types';

export function createDbNotificationServices(
  db: Db,
  auth: AuthServices,
): NotificationServices {
  const { notifications, events, pushMessages } = schema;

  return {
    async listNotifications(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const rows = await db
        .select({
          id: notifications.id,
          eventId: notifications.eventId,
          eventTitle: events.title,
          pushTitleSv: pushMessages.titleSv,
          pushTitleEn: pushMessages.titleEn,
          reason: notifications.reason,
          pushState: notifications.pushState,
          createdAt: notifications.sentAt,
          pushedAt: notifications.pushedAt,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .leftJoin(events, eq(events.id, notifications.eventId))
        .leftJoin(pushMessages, eq(pushMessages.id, notifications.pushMessageId))
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.sentAt))
        .limit(100);

      const [unread] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

      return {
        items: rows.map((r) => ({
          id: r.id,
          eventId: r.eventId,
          eventTitle: r.eventTitle ?? r.pushTitleSv ?? r.pushTitleEn ?? 'Notification',
          reason: r.reason,
          pushState: r.pushState,
          createdAt: r.createdAt.toISOString(),
          pushedAt: r.pushedAt?.toISOString() ?? null,
          readAt: r.readAt?.toISOString() ?? null,
        })),
        unreadCount: Number(unread?.count ?? 0),
      };
    },
  };
}

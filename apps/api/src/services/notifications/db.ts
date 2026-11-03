import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { notificationMessageFields } from './copy';
import { NotificationError, type NotificationServices } from './types';

export function createDbNotificationServices(db: Db, auth: AuthServices): NotificationServices {
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
          pushBodySv: pushMessages.bodySv,
          pushBodyEn: pushMessages.bodyEn,
          pushKind: pushMessages.kind,
          pushTipStatus: pushMessages.tipStatus,
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
          eventTitle: r.eventTitle ?? r.pushTitleSv ?? r.pushTitleEn ?? '',
          reason: r.reason,
          pushState: r.pushState,
          createdAt: r.createdAt.toISOString(),
          pushedAt: r.pushedAt?.toISOString() ?? null,
          readAt: r.readAt?.toISOString() ?? null,
          ...notificationMessageFields(
            r.pushKind
              ? {
                  titleSv: r.pushTitleSv ?? '',
                  titleEn: r.pushTitleEn ?? '',
                  bodySv: r.pushBodySv ?? '',
                  bodyEn: r.pushBodyEn ?? '',
                  kind: r.pushKind,
                  tipStatus: r.pushTipStatus,
                }
              : null,
          ),
        })),
        unreadCount: Number(unread?.count ?? 0),
      };
    },
    async deleteNotification(sessionToken, notificationId) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const removed = await db
        .delete(notifications)
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning({ id: notifications.id });
      if (removed.length === 0) throw new NotificationError('not_found');
    },
    async setNotificationRead(sessionToken, notificationId, read) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const updated = await db
        .update(notifications)
        .set({ readAt: read ? new Date() : null })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning({ id: notifications.id });
      if (updated.length === 0) throw new NotificationError('not_found');
    },
    async markAllNotificationsRead(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    },
  };
}

import type { AuthServices } from '../auth/types';
import type { MemoryStore } from '../memory-store';
import { notificationMessageFields } from './copy';
import { NotificationError, type NotificationServices } from './types';

export function createMemoryNotificationServices(
  auth: AuthServices,
  store: MemoryStore,
): NotificationServices {
  return {
    async listNotifications(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const mine = [...store.notifications.values()].filter((n) => n.userId === userId);
      const items = mine
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
        .map((n) => {
          const event = store.events.get(n.eventId);
          return {
            id: n.id,
            eventId: n.eventId,
            eventTitle: event?.title ?? '',
            reason: n.reason,
            pushState: n.pushState,
            createdAt: n.sentAt.toISOString(),
            pushedAt: n.pushedAt?.toISOString() ?? null,
            readAt: n.readAt?.toISOString() ?? null,
            ...notificationMessageFields(
              n.pushMessageId ? store.pushMessages?.get(n.pushMessageId) : null,
            ),
          };
        });
      return {
        items,
        unreadCount: mine.filter((n) => n.readAt == null).length,
      };
    },
    async deleteNotification(sessionToken, notificationId) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const row = store.notifications.get(notificationId);
      if (!row || row.userId !== userId) throw new NotificationError('not_found');
      store.notifications.delete(notificationId);
    },
    async setNotificationRead(sessionToken, notificationId, read) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const row = store.notifications.get(notificationId);
      if (!row || row.userId !== userId) throw new NotificationError('not_found');
      row.readAt = read ? new Date() : null;
    },
    async markAllNotificationsRead(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const now = new Date();
      for (const row of store.notifications.values()) {
        if (row.userId === userId && row.readAt == null) row.readAt = now;
      }
    },
  };
}

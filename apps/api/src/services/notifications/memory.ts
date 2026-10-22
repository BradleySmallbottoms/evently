import type { AuthServices } from '../auth/types';
import type { MemoryStore } from '../memory-store';
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
            eventTitle: event?.title ?? 'Event',
            reason: n.reason,
            pushState: n.pushState,
            createdAt: n.sentAt.toISOString(),
            pushedAt: n.pushedAt?.toISOString() ?? null,
            readAt: n.readAt?.toISOString() ?? null,
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
  };
}

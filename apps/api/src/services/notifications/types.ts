import type { NotificationListResponse } from '@local-events/contracts';

export type NotificationErrorCode = 'unauthorized' | 'not_found';

export class NotificationError extends Error {
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationError';
  }
}

export type NotificationServices = {
  listNotifications: (sessionToken: string | undefined) => Promise<NotificationListResponse>;
  deleteNotification: (sessionToken: string | undefined, notificationId: string) => Promise<void>;
};

import type { NotificationItem, NotificationListResponse } from '@local-events/contracts';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export async function listNotifications(
  identity: StoredIdentity,
): Promise<NotificationListResponse> {
  return throwIfError(
    await api.GET('/me/notifications', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
}

export async function deleteNotification(
  identity: StoredIdentity,
  notificationId: string,
): Promise<void> {
  throwIfError(
    await api.DELETE('/me/notifications/{id}', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      params: { path: { id: notificationId } },
    }),
  );
}

export type { NotificationItem };

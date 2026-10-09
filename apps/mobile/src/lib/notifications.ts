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

export type { NotificationItem };

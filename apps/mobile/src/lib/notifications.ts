import type { NotificationItem } from '@local-events/contracts';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export async function listNotifications(identity: StoredIdentity): Promise<NotificationItem[]> {
  const res = throwIfError(
    await api.GET('/me/notifications', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
  return res.items;
}

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

/** Stores a report of a published event. A repeat from the same user returns the existing row. */
export async function reportEvent(identity: StoredIdentity, eventId: string) {
  return throwIfError(
    await api.POST('/events/{eventId}/reports', {
      params: { path: { eventId } },
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
}

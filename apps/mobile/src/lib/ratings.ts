import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export async function fetchRatingStatus(identity: StoredIdentity | null, eventId: string) {
  return throwIfError(
    await api.GET('/events/{eventId}/rating', {
      params: { path: { eventId } },
      ...(identity ? { headers: { Authorization: `Bearer ${identity.sessionToken}` } } : {}),
    }),
  );
}

export async function submitRating(
  identity: StoredIdentity,
  eventId: string,
  body: { score: number; comment?: string | null },
) {
  return throwIfError(
    await api.POST('/events/{eventId}/ratings', {
      params: { path: { eventId } },
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      body,
    }),
  );
}

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

function auth(identity: StoredIdentity) {
  return { Authorization: `Bearer ${identity.sessionToken}` };
}

export async function listSavedEvents(identity: StoredIdentity) {
  return throwIfError(
    await api.GET('/me/saved-events', { headers: auth(identity) }),
  );
}

export async function saveEvent(identity: StoredIdentity, eventId: string) {
  throwIfError(
    await api.PUT('/me/saved-events/{eventId}', {
      params: { path: { eventId } },
      headers: auth(identity),
    }),
  );
}

export async function unsaveEvent(identity: StoredIdentity, eventId: string) {
  throwIfError(
    await api.DELETE('/me/saved-events/{eventId}', {
      params: { path: { eventId } },
      headers: auth(identity),
    }),
  );
}

export async function listComingEvents(identity: StoredIdentity) {
  return throwIfError(
    await api.GET('/me/coming-events', { headers: auth(identity) }),
  );
}

export async function markComing(identity: StoredIdentity, eventId: string) {
  throwIfError(
    await api.PUT('/me/coming-events/{eventId}', {
      params: { path: { eventId } },
      headers: auth(identity),
    }),
  );
}

export async function clearComing(identity: StoredIdentity, eventId: string) {
  throwIfError(
    await api.DELETE('/me/coming-events/{eventId}', {
      params: { path: { eventId } },
      headers: auth(identity),
    }),
  );
}

export async function listEventLists(identity: StoredIdentity) {
  return throwIfError(await api.GET('/me/lists', { headers: auth(identity) }));
}

export async function createEventList(identity: StoredIdentity, name: string) {
  return throwIfError(
    await api.POST('/me/lists', {
      headers: auth(identity),
      body: { name },
    }),
  );
}

export async function addEventToList(identity: StoredIdentity, listId: string, eventId: string) {
  throwIfError(
    await api.PUT('/me/lists/{id}/events/{eventId}', {
      params: { path: { id: listId, eventId } },
      headers: auth(identity),
    }),
  );
}

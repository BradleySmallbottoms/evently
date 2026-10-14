import type { StoredIdentity } from './identity';
import { api, throwIfError } from './api';

function authHeaders(identity: StoredIdentity) {
  return { Authorization: `Bearer ${identity.sessionToken}` };
}

export async function getPreferences(identity: StoredIdentity) {
  return throwIfError(await api.GET('/me/preferences', { headers: authHeaders(identity) }));
}

export async function replaceInterests(identity: StoredIdentity, tagIds: string[]) {
  return throwIfError(
    await api.PUT('/me/interests', {
      headers: authHeaders(identity),
      body: { tagIds },
    }),
  );
}

export async function updateQuietHours(
  identity: StoredIdentity,
  input: { enabled: boolean; startMin: number; endMin: number },
) {
  return throwIfError(
    await api.PUT('/me/quiet-hours', {
      headers: authHeaders(identity),
      body: input,
    }),
  );
}

export async function updateTravelDistance(identity: StoredIdentity, distanceM: number) {
  return throwIfError(
    await api.PUT('/me/travel-distance', {
      headers: authHeaders(identity),
      body: { distanceM },
    }),
  );
}

export async function createCircleArea(
  identity: StoredIdentity,
  input: { name: string; lat: number; lng: number; radiusM: number },
) {
  return throwIfError(
    await api.POST('/me/areas', {
      headers: authHeaders(identity),
      body: {
        name: input.name,
        center: { lat: input.lat, lng: input.lng },
        radiusM: input.radiusM,
      },
    }),
  );
}

export async function deleteArea(identity: StoredIdentity, areaId: string) {
  throwIfError(
    await api.DELETE('/me/areas/{id}', {
      headers: authHeaders(identity),
      params: { path: { id: areaId } },
    }),
  );
}

let areaTagQueue = Promise.resolve();

/** Replace one area's tags. Later calls wait so an older response cannot overwrite a newer one. */
export function updateAreaTags(identity: StoredIdentity, areaId: string, tagIds: string[]) {
  const run = areaTagQueue.then(async () =>
    throwIfError(
      await api.PATCH('/me/areas/{id}', {
        headers: authHeaders(identity),
        params: { path: { id: areaId } },
        body: { tagIds },
      }),
    ),
  );
  areaTagQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function updateCircleArea(
  identity: StoredIdentity,
  areaId: string,
  input: { name?: string; lat: number; lng: number; radiusM: number },
) {
  return throwIfError(
    await api.PATCH('/me/areas/{id}', {
      headers: authHeaders(identity),
      params: { path: { id: areaId } },
      body: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        center: { lat: input.lat, lng: input.lng },
        radiusM: input.radiusM,
      },
    }),
  );
}

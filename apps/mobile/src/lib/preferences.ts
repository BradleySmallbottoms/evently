import type { StoredIdentity } from './identity';
import { api, throwIfError } from './api';

function authHeaders(identity: StoredIdentity) {
  return { Authorization: `Bearer ${identity.sessionToken}` };
}

export async function getPreferences(identity: StoredIdentity) {
  return throwIfError(await api.GET('/me/preferences', { headers: authHeaders(identity) }));
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

/**
 * Replace one area's tags. Later calls wait so an older response cannot overwrite a newer one.
 * An empty list also turns notifications off, so the stored switch matches nearby matching.
 */
export function updateAreaTags(
  identity: StoredIdentity,
  areaId: string,
  tagIds: string[],
  options?: { notify?: boolean },
) {
  const run = areaTagQueue.then(async () =>
    throwIfError(
      await api.PATCH('/me/areas/{id}', {
        headers: authHeaders(identity),
        params: { path: { id: areaId } },
        body: {
          tagIds,
          ...(options?.notify === undefined ? {} : { notify: options.notify }),
        },
      }),
    ),
  );
  areaTagQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function updateAreaSearchRadius(
  identity: StoredIdentity,
  areaId: string,
  radiusM: number,
) {
  return throwIfError(
    await api.PATCH('/me/areas/{id}', {
      headers: authHeaders(identity),
      params: { path: { id: areaId } },
      body: { searchRadiusM: radiusM },
    }),
  );
}

export async function updateDiscoveryRadius(identity: StoredIdentity, radiusM: number) {
  return throwIfError(
    await api.PUT('/me/discovery-radius', {
      headers: authHeaders(identity),
      body: { radiusM },
    }),
  );
}

/** Name, tags, search radius, and — for a circle — the notification radius, in one save. */
export async function updateSavedArea(
  identity: StoredIdentity,
  areaId: string,
  input: {
    name: string;
    tagIds: string[];
    searchRadiusM: number;
    notify: boolean;
    active: boolean;
    center?: { lat: number; lng: number };
    radiusM?: number;
  },
) {
  return throwIfError(
    await api.PATCH('/me/areas/{id}', {
      headers: authHeaders(identity),
      params: { path: { id: areaId } },
      body: {
        name: input.name,
        tagIds: input.tagIds,
        searchRadiusM: input.searchRadiusM,
        notify: input.notify,
        active: input.active,
        ...(input.center && input.radiusM != null
          ? { center: input.center, radiusM: input.radiusM }
          : {}),
      },
    }),
  );
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

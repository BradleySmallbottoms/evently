import type { StoredIdentity } from './identity';
import { api, throwIfError } from './api';

function authHeaders(identity: StoredIdentity) {
  return { Authorization: `Bearer ${identity.sessionToken}` };
}

export async function getPreferences(identity: StoredIdentity) {
  return throwIfError(
    await api.GET('/me/preferences', { headers: authHeaders(identity) }),
  );
}

export async function replaceInterests(identity: StoredIdentity, categoryIds: string[]) {
  return throwIfError(
    await api.PUT('/me/interests', {
      headers: authHeaders(identity),
      body: { categoryIds },
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

/** Primary active circle area for discovery, if any. */
export function primaryCircleArea(
  areas: {
    active: boolean;
    center: { lat: number; lng: number } | null;
    radiusM: number | null;
  }[],
): { lat: number; lng: number; radiusM: number } | null {
  const area = areas.find((a) => a.active && a.center && a.radiusM != null);
  if (!area?.center || area.radiusM == null) return null;
  return { lat: area.center.lat, lng: area.center.lng, radiusM: area.radiusM };
}

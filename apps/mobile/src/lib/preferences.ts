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

/** Primary active area for discovery (circle, or centroid of a region polygon). */
export function primaryCircleArea(
  areas: {
    active: boolean;
    kind?: 'manual' | 'region';
    center: { lat: number; lng: number } | null;
    radiusM: number | null;
    polygon?: { lat: number; lng: number }[] | null;
  }[],
): { lat: number; lng: number; radiusM: number } | null {
  const circle = areas.find((a) => a.active && a.center && a.radiusM != null);
  if (circle?.center && circle.radiusM != null) {
    return { lat: circle.center.lat, lng: circle.center.lng, radiusM: circle.radiusM };
  }
  const region = areas.find((a) => a.active && a.polygon && a.polygon.length >= 3);
  if (region?.polygon) {
    const lats = region.polygon.map((p) => p.lat);
    const lngs = region.polygon.map((p) => p.lng);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    return { lat, lng, radiusM: 15_000 };
  }
  return null;
}

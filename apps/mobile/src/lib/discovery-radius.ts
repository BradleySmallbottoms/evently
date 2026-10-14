import { resolveTravelDistanceM, TRAVEL_DISTANCE_STOPS_M } from '@local-events/domain';

/** Same stops as “How far can you go”: 1 km, then every 5 km through 100 km. */
export const DISCOVERY_RADIUS_STOPS_M = TRAVEL_DISTANCE_STOPS_M;

/** Matches the public event list default when the device has no saved radius. */
export const DEFAULT_DISCOVERY_RADIUS_M = 50_000;

export const DISCOVERY_RADIUS_KEY = 'le.discoveryRadiusM';

/** Snap a chosen or stored distance onto a search-radius stop. Missing values stay at 50 km. */
export function resolveDiscoveryRadiusM(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_DISCOVERY_RADIUS_M;
  return resolveTravelDistanceM(value);
}

export function parseDiscoveryRadiusM(raw: string | null): number {
  if (raw == null || raw.trim() === '') return DEFAULT_DISCOVERY_RADIUS_M;
  return resolveDiscoveryRadiusM(Number(raw));
}

/**
 * Stored search radii keyed by place id. A lone number is the older single radius
 * and belongs to “Near you”.
 */
export function parseDiscoveryRadiusMap(
  raw: string | null,
  nearbyId = 'nearby',
): Record<string, number> {
  if (raw == null || raw.trim() === '') return {};
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    const meters = Number(trimmed);
    if (!Number.isFinite(meters)) return {};
    return { [nearbyId]: resolveDiscoveryRadiusM(meters) };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const radii: Record<string, number> = {};
    for (const [placeId, value] of Object.entries(parsed)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      radii[placeId] = resolveDiscoveryRadiusM(value);
    }
    return radii;
  } catch {
    return {};
  }
}

/** Saved slider value for this place, otherwise the area radius, otherwise 50 km. */
export function discoveryRadiusForPlace(
  placeId: string,
  stored: Readonly<Record<string, number>>,
  areaRadiusM?: number | null,
): number {
  const chosen = stored[placeId];
  if (chosen != null) return chosen;
  if (areaRadiusM == null) return DEFAULT_DISCOVERY_RADIUS_M;
  return resolveDiscoveryRadiusM(areaRadiusM);
}

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

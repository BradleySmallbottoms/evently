import { REGION_SUGGESTION } from '@local-events/domain';
import { distanceMeters } from '@local-events/geo';

/** Public event search rejects a radius above this. */
const MAX_QUERY_RADIUS_M = 200_000;

type DiscoveryArea = {
  active: boolean;
  center: { lat: number; lng: number } | null;
  radiusM: number | null;
  polygon?: { lat: number; lng: number }[] | null;
};

/** Search point for one saved area: its circle, or the centroid of a region polygon. */
export function queryPointForArea(
  area: DiscoveryArea,
): { lat: number; lng: number; radiusM: number } | null {
  if (!area.active) return null;
  if (area.center && area.radiusM != null) {
    return { lat: area.center.lat, lng: area.center.lng, radiusM: area.radiusM };
  }
  const polygon = area.polygon;
  if (!polygon || polygon.length < 3) return null;
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const halfDiagonal =
    distanceMeters({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng }) / 2;
  const radiusM = Math.round(
    Math.min(MAX_QUERY_RADIUS_M, Math.max(REGION_SUGGESTION.fallbackRadiusM, halfDiagonal)),
  );
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, radiusM };
}

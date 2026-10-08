export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). Good enough for geofences and region checks. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * True when `point` is inside a circle, optionally widened by an accuracy allowance
 * (the device's reported GPS accuracy, already capped by the caller).
 */
export function isWithinRadius(
  point: GeoPoint,
  center: GeoPoint,
  radiusM: number,
  accuracyAllowanceM = 0,
): boolean {
  return distanceMeters(point, center) <= radiusM + accuracyAllowanceM;
}

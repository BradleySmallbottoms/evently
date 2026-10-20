/** Söderhamn, the launch area, when an event has no point yet. */
export const DEFAULT_MAP_CENTER = { lat: 61.303, lng: 17.059 };

const COORDINATE = /^-?\d+(\.\d+)?$/;

export type MapPoint = { lat: number; lng: number };

export type EventLocationMapProps = {
  lat: string;
  lng: string;
  radiusM: string;
  onPlace: (lat: string, lng: string) => void;
};

/** A complete latitude and longitude, or nothing while a field is empty or half-typed. */
export function mapPoint(lat: string, lng: string): MapPoint | null {
  const latText = lat.trim();
  const lngText = lng.trim();
  if (!COORDINATE.test(latText) || !COORDINATE.test(lngText)) return null;
  const latN = Number(latText);
  const lngN = Number(lngText);
  if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) return null;
  return { lat: latN, lng: lngN };
}

/** Six decimal places, about a tenth of a metre. */
export function formatMapCoordinate(value: number): string {
  return value.toFixed(6);
}

/** A positive whole-metre check-in radius, or nothing when the field is empty or invalid. */
export function geofenceMeters(value: string): number | null {
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  return Number(text);
}

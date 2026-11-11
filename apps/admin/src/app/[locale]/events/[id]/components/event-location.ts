/** Söderhamn, the launch area, when an event has no point yet. */
export const DEFAULT_MAP_CENTER = { lat: 61.303, lng: 17.059 };

const COORDINATE = /^-?\d+(\.\d+)?$/;

export type MapPoint = { lat: number; lng: number };

export type EventLocationMapProps = {
  lat: string;
  lng: string;
  radiusM: string;
  /** Shown under the map. The check-in radius sentence is added when the circle is drawn. */
  caption?: string;
  /** A click or a dragged pin reports a new point. Omitted, the pin only shows the point. */
  onPlace?: (lat: string, lng: string) => void;
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

/** Latitude and longitude fields for a stored point. Empty when the point is missing. */
export function coordinateText(
  location: { lat: number | string; lng: number | string } | null | undefined,
): { lat: string; lng: string } {
  if (!location) return { lat: '', lng: '' };
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: '', lng: '' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { lat: '', lng: '' };
  return { lat: formatMapCoordinate(lat), lng: formatMapCoordinate(lng) };
}

/** A positive whole-metre check-in radius, or nothing when the field is empty or invalid. */
export function geofenceMeters(value: string): number | null {
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  return Number(text);
}

/** Start, end, and venue for one showing in the place-tab list. */
export function occasionOptionLabel(
  occasion: { startsAt: string; endsAt: string; venueName: string | null },
  timeZone: string,
  locale: string,
): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  const start = format(occasion.startsAt);
  const end = format(occasion.endsAt);
  const when = start === end ? start : `${start} – ${end}`;
  const venue = occasion.venueName?.trim();
  return venue ? `${when} · ${venue}` : when;
}

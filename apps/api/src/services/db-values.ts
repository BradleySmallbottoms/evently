import type { Event } from '@local-events/contracts';

/**
 * A timestamp column arrives as a Date. A `min`/`max` subquery arrives as text,
 * because postgres.js does not parse values outside a mapped column.
 */
export function dbTimestamp(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `ST_Y` / `ST_X` from a subquery may arrive as a string. */
export function dbPoint(
  lat: number | string | null,
  lng: number | string | null,
): Event['location'] {
  if (lat == null || lng == null) return null;
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  return { lat: latN, lng: lngN };
}

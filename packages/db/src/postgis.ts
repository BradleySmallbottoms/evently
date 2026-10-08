import { customType } from 'drizzle-orm/pg-core';

/**
 * PostGIS geography columns. drizzle-kit quotes custom type names, so a constrained type like
 * geography(Point,4326) would become an invalid quoted identifier; plain `geography` is used
 * instead (geography defaults to SRID 4326). Keep the shape (point/polygon) by convention and,
 * if needed, a CHECK constraint (ST_GeometryType) in a custom migration.
 *
 * Write values as EWKT, e.g. `SRID=4326;POINT(17.0592 61.3037)` (lng lat order!), with
 * `pointEwkt()`. Values come back from the driver as hex EWKB, so query with ST_* functions in
 * SQL (ST_DWithin, ST_Covers, ST_AsGeoJSON) instead of decoding in JS.
 */
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography';
  },
});

export const geographyPoint = geography;
export const geographyPolygon = geography;
export const geographyMultiPolygon = geography;

export function pointEwkt(p: { lat: number; lng: number }): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

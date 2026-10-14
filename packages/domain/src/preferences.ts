/** Soft cap on saved areas per user (launch plan). */
export const MAX_SAVED_AREAS = 20;

export const MIN_AREA_RADIUS_M = 500;
export const MAX_AREA_RADIUS_M = 100_000;

/** Circle sizes offered when saving an area, including onboarding. */
export const AREA_RADIUS_PRESETS_M = [5_000, 25_000, 50_000, 100_000] as const;
export type AreaRadiusPresetM = (typeof AREA_RADIUS_PRESETS_M)[number];
export const DEFAULT_AREA_RADIUS_M: AreaRadiusPresetM = 25_000;

export function canAddSavedArea(currentCount: number): boolean {
  return currentCount < MAX_SAVED_AREAS;
}

/**
 * Nearby notifications for one saved area. The switch only counts when that
 * area has at least one category. An empty list shows every event on home
 * and does not match nearby push.
 */
export function areaNotificationsEnabled(area: {
  notify: boolean;
  tagIds: readonly string[];
}): boolean {
  return area.notify && area.tagIds.length > 0;
}

export function validateCircleArea(input: {
  center: { lat: number; lng: number };
  radiusM: number;
}): { ok: true } | { ok: false; reason: 'radius_out_of_range' } {
  if (input.radiusM < MIN_AREA_RADIUS_M || input.radiusM > MAX_AREA_RADIUS_M) {
    return { ok: false, reason: 'radius_out_of_range' };
  }
  return { ok: true };
}

export function validatePolygonArea(input: {
  polygon: { lat: number; lng: number }[];
}): { ok: true } | { ok: false; reason: 'polygon_too_small' | 'polygon_too_large' } {
  if (input.polygon.length < 3) return { ok: false, reason: 'polygon_too_small' };
  if (input.polygon.length > 100) return { ok: false, reason: 'polygon_too_large' };
  return { ok: true };
}

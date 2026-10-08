import { distanceMeters, type GeoPoint } from '@local-events/geo';

/** Tunable thresholds for region-subscription suggestions (runs on the device). */
export const REGION_SUGGESTION = {
  minDistanceFromSavedAreasM: 25_000,
  minForegroundSeconds: 60,
  minScreensOpened: 3,
  minHoursBetweenPrompts: 24,
  declinedCooldownDays: 90,
  fallbackRadiusM: 15_000,
} as const;

export interface SavedArea {
  center: GeoPoint;
  radiusM: number;
}

export interface RegionSuggestionInput {
  location: GeoPoint;
  savedAreas: SavedArea[];
  foregroundSeconds: number;
  screensOpened: number;
  isCheckingIn: boolean;
  lastPromptAt: Date | null;
  /** Declines for nearby places (stored on the device only). */
  declines: { center: GeoPoint; at: Date; permanent: boolean }[];
  now: Date;
}

export function shouldSuggestRegion(input: RegionSuggestionInput): boolean {
  const t = REGION_SUGGESTION;
  if (input.isCheckingIn) return false;
  const active =
    input.foregroundSeconds >= t.minForegroundSeconds || input.screensOpened >= t.minScreensOpened;
  if (!active) return false;

  if (input.lastPromptAt) {
    const hours = (input.now.getTime() - input.lastPromptAt.getTime()) / 3_600_000;
    if (hours < t.minHoursBetweenPrompts) return false;
  }

  const farFromSaved = input.savedAreas.every(
    (a) => distanceMeters(input.location, a.center) - a.radiusM > t.minDistanceFromSavedAreasM,
  );
  if (!farFromSaved) return false;

  const blocked = input.declines.some((d) => {
    if (distanceMeters(input.location, d.center) > t.minDistanceFromSavedAreasM) return false;
    if (d.permanent) return true;
    const days = (input.now.getTime() - d.at.getTime()) / 86_400_000;
    return days < t.declinedCooldownDays;
  });
  return !blocked;
}

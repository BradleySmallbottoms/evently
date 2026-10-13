import { distanceMeters, type GeoPoint } from '@local-events/geo';

/** Default for the profile setting “How far can you go”. */
export const DEFAULT_TRAVEL_DISTANCE_M = 25_000;

/**
 * Slider stops for “How far can you go”: 1 km, then every 5 km through 100 km.
 * A value halfway between two stops lands on the higher one.
 */
export const TRAVEL_DISTANCE_STOPS_M: readonly number[] = [
  1_000,
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 5_000),
];

/** Snap a stored or chosen distance onto a slider stop. */
export function resolveTravelDistanceM(value: number | null | undefined): number {
  const raw = value == null || !Number.isFinite(value) ? DEFAULT_TRAVEL_DISTANCE_M : value;
  let best: number = TRAVEL_DISTANCE_STOPS_M[0];
  let bestDelta = Infinity;
  for (const stop of TRAVEL_DISTANCE_STOPS_M) {
    const delta = Math.abs(stop - raw);
    if (delta < bestDelta || (delta === bestDelta && stop > best)) {
      best = stop;
      bestDelta = delta;
    }
  }
  return best;
}

/** Tunable thresholds for region-subscription suggestions (runs on the device). */
export const REGION_SUGGESTION = {
  /** Fallback when the profile has no travel distance yet. */
  minDistanceFromSavedAreasM: DEFAULT_TRAVEL_DISTANCE_M,
  minForegroundSeconds: 60,
  minScreensOpened: 3,
  minHoursBetweenPrompts: 24,
  /** Decline while the user already has saved areas. */
  declinedCooldownDays: 90,
  /** No saved regions yet: a dismiss hides the prompt for a week near that place. */
  firstRegionDismissDays: 7,
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
  /** Profile setting. Defaults to 25 km. */
  travelDistanceM?: number;
}

export function shouldSuggestRegion(input: RegionSuggestionInput): boolean {
  const t = REGION_SUGGESTION;
  const distanceM = resolveTravelDistanceM(input.travelDistanceM);
  if (input.isCheckingIn) return false;

  const firstRegion = input.savedAreas.length === 0;
  if (!firstRegion) {
    const active =
      input.foregroundSeconds >= t.minForegroundSeconds ||
      input.screensOpened >= t.minScreensOpened;
    if (!active) return false;

    const farFromSaved = input.savedAreas.every(
      (a) => distanceMeters(input.location, a.center) - a.radiusM > distanceM,
    );
    if (!farFromSaved) return false;
  }

  const pastEveryDecline =
    input.declines.length > 0 &&
    input.declines.every((d) => distanceMeters(input.location, d.center) > distanceM);
  // The daily cap follows the place that was dismissed. A new place farther than
  // the profile travel distance is asked immediately, including the same day.
  if (input.lastPromptAt && !pastEveryDecline) {
    const hours = (input.now.getTime() - input.lastPromptAt.getTime()) / 3_600_000;
    if (hours < t.minHoursBetweenPrompts) return false;
  }

  const cooldownDays = firstRegion ? t.firstRegionDismissDays : t.declinedCooldownDays;
  const blocked = input.declines.some((d) => {
    const nearby = distanceMeters(input.location, d.center) <= distanceM;
    if (!nearby) return false;
    if (d.permanent) return true;
    const days = (input.now.getTime() - d.at.getTime()) / 86_400_000;
    return days < cooldownDays;
  });
  return !blocked;
}

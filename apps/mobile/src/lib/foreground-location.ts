import { distanceMeters, type GeoPoint } from '@local-events/geo';

/** Ignore GPS jitter smaller than this when publishing a discovery point. */
export const FOREGROUND_LOCATION_MIN_MOVE_M = 100;

/** Re-check a region suggestion after the device moves this far while staying open. */
export const REGION_LOCATION_REFRESH_M = 1_000;

export type LocationSample = GeoPoint;

export type DeviceLocationFix = GeoPoint & {
  /** False when permission is missing and the point is the launch-area fallback. */
  located: boolean;
};

export type DeviceLocationSnapshot = {
  fix: DeviceLocationFix | null;
  /** Completed foreground samples, including ones that did not move the point. */
  check: number;
};

export type ForegroundLocationPort = {
  permissionGranted: () => Promise<boolean>;
  /** Throws if the read fails. Called only when permission is granted. */
  currentPosition: () => Promise<LocationSample>;
  watch: (onUpdate: (sample: LocationSample) => void) => Promise<{ remove: () => void }>;
};

const EMPTY: DeviceLocationSnapshot = { fix: null, check: 0 };

export function createForegroundLocationSession(
  port: ForegroundLocationPort,
  options: { fallback: GeoPoint; minMoveM?: number },
) {
  const minMoveM = options.minMoveM ?? FOREGROUND_LOCATION_MIN_MOVE_M;
  const listeners = new Set<() => void>();
  let snapshot: DeviceLocationSnapshot = EMPTY;
  let watch: { remove: () => void } | null = null;
  let epoch = 0;

  function commit(next: DeviceLocationSnapshot) {
    if (next.fix === snapshot.fix && next.check === snapshot.check) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function moved(sample: GeoPoint) {
    if (!snapshot.fix?.located) return true;
    return distanceMeters(snapshot.fix, sample) >= minMoveM;
  }

  function publishSample(sample: LocationSample, countForeground: boolean) {
    const nextFix = moved(sample)
      ? { lat: sample.lat, lng: sample.lng, located: true as const }
      : snapshot.fix;
    commit({
      fix: nextFix,
      check: snapshot.check + (countForeground ? 1 : 0),
    });
  }

  function publishFallback() {
    const same =
      snapshot.fix != null &&
      !snapshot.fix.located &&
      snapshot.fix.lat === options.fallback.lat &&
      snapshot.fix.lng === options.fallback.lng;
    commit({
      fix: same ? snapshot.fix : { ...options.fallback, located: false },
      check: snapshot.check + 1,
    });
  }

  function stopWatch() {
    watch?.remove();
    watch = null;
  }

  async function ensureWatch(token: number) {
    if (watch) return;
    let sub: { remove: () => void };
    try {
      sub = await port.watch((sample) => {
        if (token !== epoch) return;
        publishSample(sample, false);
      });
    } catch {
      return;
    }
    if (token !== epoch || watch) {
      sub.remove();
      return;
    }
    watch = sub;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onBackground() {
      epoch += 1;
      stopWatch();
    },
    async onForeground() {
      const token = ++epoch;
      stopWatch();
      let granted = false;
      try {
        granted = await port.permissionGranted();
      } catch {
        return;
      }
      if (token !== epoch) return;
      if (!granted) {
        publishFallback();
        return;
      }
      try {
        const sample = await port.currentPosition();
        if (token !== epoch) return;
        publishSample(sample, true);
      } catch {
        if (token !== epoch) return;
        if (!snapshot.fix) publishFallback();
      }
      if (token !== epoch) return;
      await ensureWatch(token);
    },
  };
}

export function shouldReevaluateRegionSuggestion(
  previous: GeoPoint | null,
  next: GeoPoint,
  foregroundCheckChanged: boolean,
  minDistanceM = REGION_LOCATION_REFRESH_M,
): boolean {
  if (!previous || foregroundCheckChanged) return true;
  return distanceMeters(previous, next) >= minDistanceM;
}

/**
 * The save-place sheet is a native modal and draws above the splash cover.
 * Keep it closed until that cover has finished fading out.
 */
export function shouldPresentRegionSheet(splashDismissed: boolean, requested: boolean): boolean {
  return splashDismissed && requested;
}

/**
 * Home stays mounted under onboarding. Granting location there is not a new
 * place: hold the prompt until onboarding is gone and the device has moved.
 */
export function shouldHoldRegionSuggestion(input: {
  onboardingVisible: boolean;
  anchor: GeoPoint | null;
  location: GeoPoint;
  minMoveM?: number;
}): boolean {
  if (input.onboardingVisible) return true;
  if (!input.anchor) return false;
  const minMoveM = input.minMoveM ?? REGION_LOCATION_REFRESH_M;
  return distanceMeters(input.anchor, input.location) < minMoveM;
}

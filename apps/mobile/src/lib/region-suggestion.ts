import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { REGION_SUGGESTION, shouldSuggestRegion, type SavedArea } from '@local-events/domain';

import { api, throwIfError } from './api';
import { readBalancedForegroundPosition } from './events';
import type { StoredIdentity } from './identity';
import { placeLabelFromGeocode } from './place-name';

/** Device-only region prompt timers and dismissals. */
const KEYS = {
  lastPromptAt: 'le.region.lastPromptAt',
  declines: 'le.region.declines',
  foregroundStartedAt: 'le.region.fgStartedAt',
  screensOpened: 'le.region.screensOpened',
} as const;

export const REGION_PROMPT_STORAGE_KEYS = Object.values(KEYS);

type Decline = { lat: number; lng: number; at: string; permanent: boolean };

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export type RegionSuggestion = {
  lat: number;
  lng: number;
  name: string;
  regionId: string | null;
};

async function readDeclines(): Promise<Decline[]> {
  const raw = await getItem(KEYS.declines);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Decline[];
  } catch {
    return [];
  }
}

/**
 * Skipping the onboarding area step is a dismiss of the first save prompt.
 * The same 7-day quiet period applies near this place.
 */
export async function deferRegionPromptAfterAreaSkip(
  point?: { lat: number; lng: number } | null,
): Promise<void> {
  if (point) {
    await recordRegionDecline(point, false);
    return;
  }
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return;
  try {
    await recordRegionDecline(await readBalancedForegroundPosition(), false);
  } catch {
    // No point to attach the quiet period to.
  }
}

export async function recordRegionDecline(
  point: { lat: number; lng: number },
  permanent: boolean,
): Promise<void> {
  const declines = await readDeclines();
  declines.push({ ...point, at: new Date().toISOString(), permanent });
  await setItem(KEYS.declines, JSON.stringify(declines.slice(-50)));
  await setItem(KEYS.lastPromptAt, new Date().toISOString());
}

export async function markRegionPromptShown(): Promise<void> {
  await setItem(KEYS.lastPromptAt, new Date().toISOString());
}

export async function bumpRegionActivity(): Promise<void> {
  const started = await getItem(KEYS.foregroundStartedAt);
  if (!started) {
    await setItem(KEYS.foregroundStartedAt, String(Date.now()));
  }
  const raw = await getItem(KEYS.screensOpened);
  const n = raw ? Number(raw) : 0;
  await setItem(KEYS.screensOpened, String(n + 1));
}

async function activityStats(): Promise<{ foregroundSeconds: number; screensOpened: number }> {
  const started = await getItem(KEYS.foregroundStartedAt);
  const foregroundSeconds = started ? Math.max(0, (Date.now() - Number(started)) / 1000) : 0;
  const raw = await getItem(KEYS.screensOpened);
  return { foregroundSeconds, screensOpened: raw ? Number(raw) : 0 };
}

async function reverseGeocodedPlaceName(lat: number, lng: number): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return placeLabelFromGeocode(places[0]);
  } catch {
    return null;
  }
}

/** Evaluate whether to offer a region subscription for the current place. */
export async function evaluateRegionSuggestion(input: {
  savedAreas: SavedArea[];
  /** Used when neither the geocoder nor region lookup yields a name. */
  fallbackName: string;
  /** Already-read foreground fix. When omitted, one sample is taken if permission is granted. */
  location?: { lat: number; lng: number };
  /** Profile setting. Defaults to 25 km. */
  travelDistanceM?: number;
}): Promise<RegionSuggestion | null> {
  let location = input.location ?? null;
  if (!location) {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    try {
      location = await readBalancedForegroundPosition();
    } catch {
      return null;
    }
  }

  const lastPromptRaw = await getItem(KEYS.lastPromptAt);
  const declines = await readDeclines();
  const activity = await activityStats();

  const ok = shouldSuggestRegion({
    location,
    savedAreas: input.savedAreas,
    foregroundSeconds: activity.foregroundSeconds,
    screensOpened: activity.screensOpened,
    isCheckingIn: false,
    lastPromptAt: lastPromptRaw ? new Date(lastPromptRaw) : null,
    declines: declines.map((d) => ({
      center: { lat: d.lat, lng: d.lng },
      at: new Date(d.at),
      permanent: d.permanent,
    })),
    now: new Date(),
    travelDistanceM: input.travelDistanceM,
  });
  if (!ok) return null;

  const lookup = throwIfError(
    await api.GET('/regions/lookup', {
      params: { query: { lat: location.lat, lng: location.lng } },
    }),
  );

  const regionName = lookup.region?.name?.trim() || null;
  const geocodedName = regionName
    ? null
    : await reverseGeocodedPlaceName(location.lat, location.lng);

  return {
    lat: location.lat,
    lng: location.lng,
    name: regionName || geocodedName || input.fallbackName,
    regionId: lookup.region?.id ?? null,
  };
}

export async function acceptRegionSuggestion(
  identity: StoredIdentity,
  suggestion: RegionSuggestion,
  notify: boolean,
): Promise<void> {
  if (suggestion.regionId) {
    throwIfError(
      await api.POST('/me/areas', {
        headers: { Authorization: `Bearer ${identity.sessionToken}` },
        body: {
          name: suggestion.name,
          regionId: suggestion.regionId,
          origin: 'suggested',
          notify,
        },
      }),
    );
  } else {
    throwIfError(
      await api.POST('/me/areas', {
        headers: { Authorization: `Bearer ${identity.sessionToken}` },
        body: {
          name: suggestion.name,
          center: { lat: suggestion.lat, lng: suggestion.lng },
          radiusM: REGION_SUGGESTION.fallbackRadiusM,
          origin: 'suggested',
          notify,
        },
      }),
    );
  }
  await markRegionPromptShown();
}

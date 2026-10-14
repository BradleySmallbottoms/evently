import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { resolveEventQueryPoint, type EventQueryPoint } from './events';
import { getDeviceLocation, useDeviceLocation } from './device-location';
import { discoveryRadiusForPlace } from './discovery-radius';
import {
  getDiscoveryRadiusMap,
  hydrateDiscoveryRadius,
  subscribeDiscoveryRadius,
} from './discovery-radius-store';
import { ensureIdentity } from './identity';
import { queryPointForArea } from './area-point';
import { getPreferences } from './preferences';

/** Menu id for the device location. Saved areas use their own ids. */
export const NEARBY_PLACE_ID = 'nearby';

/** Slider value for “Near you” and each saved area, including areas with no stored choice yet. */
export function radiiForPlaces(
  radiusMap: Readonly<Record<string, number>>,
  areas: ReadonlyArray<{ id: string } & Parameters<typeof queryPointForArea>[0]>,
): Record<string, number> {
  const radii: Record<string, number> = {
    [NEARBY_PLACE_ID]: discoveryRadiusForPlace(NEARBY_PLACE_ID, radiusMap),
  };
  for (const area of areas) {
    radii[area.id] = discoveryRadiusForPlace(area.id, radiusMap, queryPointForArea(area)?.radiusM);
  }
  return radii;
}

const DISCOVERY_PLACE_KEY = 'le.discoveryPlaceId';

let discoveryPlaceId = NEARBY_PLACE_ID;
let chosenSinceLaunch = false;
const discoveryPlaceListeners = new Set<() => void>();

function subscribeDiscoveryPlace(listener: () => void) {
  discoveryPlaceListeners.add(listener);
  return () => {
    discoveryPlaceListeners.delete(listener);
  };
}

function notifyDiscoveryPlace() {
  for (const listener of discoveryPlaceListeners) listener();
}

async function readStoredPlaceId(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(DISCOVERY_PLACE_KEY) ?? null;
  return SecureStore.getItemAsync(DISCOVERY_PLACE_KEY);
}

async function writeStoredPlaceId(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(DISCOVERY_PLACE_KEY, id);
    return;
  }
  await SecureStore.setItemAsync(DISCOVERY_PLACE_KEY, id);
}

let hydratePromise: Promise<string> | null = null;

/** Load the last chosen area before discovery queries run. */
export function hydrateDiscoveryPlace(): Promise<string> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const stored = await readStoredPlaceId();
      if (!chosenSinceLaunch && stored) {
        discoveryPlaceId = stored;
        notifyDiscoveryPlace();
      }
      return discoveryPlaceId;
    })();
  }
  return hydratePromise;
}

export function getDiscoveryPlaceId() {
  return discoveryPlaceId;
}

/** Remember the chosen area in memory and secure storage. */
export async function setDiscoveryPlaceId(next: string): Promise<void> {
  chosenSinceLaunch = true;
  if (next !== discoveryPlaceId) {
    discoveryPlaceId = next;
    notifyDiscoveryPlace();
  }
  await writeStoredPlaceId(next);
}

export function useDiscoveryPlaceId() {
  return useSyncExternalStore(subscribeDiscoveryPlace, getDiscoveryPlaceId, getDiscoveryPlaceId);
}

export function useDiscoveryRadiusMap() {
  return useSyncExternalStore(subscribeDiscoveryRadius, getDiscoveryRadiusMap, getDiscoveryRadiusMap);
}

function pointFromFix(fix: { lat: number; lng: number }, radiusM: number): EventQueryPoint {
  return { lat: fix.lat, lng: fix.lng, radiusM };
}

/** Device location, or the saved area currently chosen in the location menu. */
export function useDiscoveryPoint() {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const queryClient = useQueryClient();
  const device = useDeviceLocation();
  const hydration = useQuery({
    queryKey: ['discovery-place'],
    queryFn: () => hydrateDiscoveryPlace(),
    staleTime: Infinity,
  });
  const radiusHydration = useQuery({
    queryKey: ['discovery-radius'],
    queryFn: () => hydrateDiscoveryRadius(),
    staleTime: Infinity,
  });
  const placeId = useDiscoveryPlaceId();
  const radiusMap = useDiscoveryRadiusMap();
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
    retry: false,
  });
  const selectedArea =
    placeId === NEARBY_PLACE_ID
      ? null
      : (preferences.data?.areas ?? []).find((area) => area.id === placeId);
  const selectedPoint = selectedArea ? queryPointForArea(selectedArea) : null;
  const nearby = placeId === NEARBY_PLACE_ID;
  const radiusM = discoveryRadiusForPlace(
    placeId,
    radiusMap,
    nearby ? null : selectedPoint?.radiusM,
  );

  useEffect(() => {
    if (!hydration.isSuccess || !preferences.isSuccess) return;
    if (placeId === NEARBY_PLACE_ID) return;
    const exists = (preferences.data?.areas ?? []).some((area) => area.id === placeId);
    if (!exists) void setDiscoveryPlaceId(NEARBY_PLACE_ID);
  }, [hydration.isSuccess, preferences.isSuccess, preferences.data?.areas, placeId]);

  useEffect(() => {
    if (!device.fix) return;
    const next = pointFromFix(device.fix, radiusM);
    queryClient.setQueryData<EventQueryPoint>(
      ['event-query-point', NEARBY_PLACE_ID, radiusM],
      (prev) => {
        if (prev && prev.lat === next.lat && prev.lng === next.lng && prev.radiusM === next.radiusM) {
          return prev;
        }
        return next;
      },
    );
  }, [device.fix, radiusM, queryClient]);

  const point = useQuery({
    queryKey: nearby
      ? ['event-query-point', NEARBY_PLACE_ID, radiusM]
      : ['event-query-point', placeId, selectedPoint?.lat, selectedPoint?.lng, radiusM],
    queryFn: async (): Promise<EventQueryPoint> => {
      if (selectedPoint) return { ...selectedPoint, radiusM };
      const fix = getDeviceLocation().fix;
      if (fix) return pointFromFix(fix, radiusM);
      const resolved = await resolveEventQueryPoint();
      return { ...resolved, radiusM };
    },
    enabled:
      hydration.isSuccess &&
      radiusHydration.isSuccess &&
      !identity.isPending &&
      (identity.isError || !preferences.isLoading) &&
      (nearby ? device.fix != null : preferences.isSuccess),
    retry: false,
  });
  return { identity, preferences, point, placeId, radiusM, radiusMap, device };
}

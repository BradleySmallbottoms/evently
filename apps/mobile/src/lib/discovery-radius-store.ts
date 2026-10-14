import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  DISCOVERY_RADIUS_KEY,
  parseDiscoveryRadiusMap,
  resolveDiscoveryRadiusM,
} from './discovery-radius';

let radiiByPlace: Record<string, number> = {};
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeDiscoveryRadius(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readStoredRadius(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(DISCOVERY_RADIUS_KEY) ?? null;
  return SecureStore.getItemAsync(DISCOVERY_RADIUS_KEY);
}

async function writeStoredRadius(radii: Record<string, number>): Promise<void> {
  const raw = JSON.stringify(radii);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(DISCOVERY_RADIUS_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(DISCOVERY_RADIUS_KEY, raw);
}

let hydratePromise: Promise<Record<string, number>> | null = null;

/** Load each place's search radius before discovery queries run. */
export function hydrateDiscoveryRadius(): Promise<Record<string, number>> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      radiiByPlace = parseDiscoveryRadiusMap(await readStoredRadius());
      notify();
      return radiiByPlace;
    })();
  }
  return hydratePromise;
}

export function getDiscoveryRadiusMap() {
  return radiiByPlace;
}

/** Remember how far event search should look for one place. */
export async function setDiscoveryRadiusForPlace(placeId: string, next: number): Promise<void> {
  const radiusM = resolveDiscoveryRadiusM(next);
  if (radiiByPlace[placeId] === radiusM) return;
  radiiByPlace = { ...radiiByPlace, [placeId]: radiusM };
  notify();
  await writeStoredRadius(radiiByPlace);
}

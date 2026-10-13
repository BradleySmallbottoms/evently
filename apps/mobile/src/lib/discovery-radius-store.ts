import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  DISCOVERY_RADIUS_KEY,
  parseDiscoveryRadiusM,
  resolveDiscoveryRadiusM,
  DEFAULT_DISCOVERY_RADIUS_M,
} from './discovery-radius';

let discoveryRadiusM = DEFAULT_DISCOVERY_RADIUS_M;
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

async function writeStoredRadius(radiusM: number): Promise<void> {
  const raw = String(radiusM);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(DISCOVERY_RADIUS_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(DISCOVERY_RADIUS_KEY, raw);
}

let hydratePromise: Promise<number> | null = null;

/** Load the last search radius before discovery queries run. */
export function hydrateDiscoveryRadius(): Promise<number> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      discoveryRadiusM = parseDiscoveryRadiusM(await readStoredRadius());
      notify();
      return discoveryRadiusM;
    })();
  }
  return hydratePromise;
}

export function getDiscoveryRadiusM() {
  return discoveryRadiusM;
}

/** Remember how far event search should look, in memory and on device. */
export async function setDiscoveryRadiusM(next: number): Promise<void> {
  const radiusM = resolveDiscoveryRadiusM(next);
  if (radiusM !== discoveryRadiusM) {
    discoveryRadiusM = radiusM;
    notify();
  }
  await writeStoredRadius(radiusM);
}

import * as Location from 'expo-location';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { FALLBACK_CENTER, readBalancedForegroundPosition } from './events';
import {
  createForegroundLocationSession,
  type DeviceLocationSnapshot,
} from './foreground-location';

/** Native watch delivers an update after the device moves about this far. */
export const LOCATION_WATCH_DISTANCE_M = 100;

const session = createForegroundLocationSession(
  {
    permissionGranted: async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      return perm.status === 'granted';
    },
    currentPosition: () => readBalancedForegroundPosition(),
    watch: (onUpdate) =>
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LOCATION_WATCH_DISTANCE_M,
          timeInterval: 15_000,
          mayShowUserSettingsDialog: false,
        },
        (position) => {
          onUpdate({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
      ),
  },
  { fallback: { lat: FALLBACK_CENTER.lat, lng: FALLBACK_CENTER.lng } },
);

export function useDeviceLocation(): DeviceLocationSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

export function getDeviceLocation(): DeviceLocationSnapshot {
  return session.getSnapshot();
}

/** Sample on each foreground and watch until the app backgrounds. No background location. */
export function startDeviceLocation(): () => void {
  const onChange = (next: AppStateStatus) => {
    if (next === 'active') void session.onForeground();
    else if (next === 'background') session.onBackground();
  };
  const sub = AppState.addEventListener('change', onChange);
  if (AppState.currentState === 'active') void session.onForeground();
  return () => {
    sub.remove();
    session.onBackground();
  };
}

/** Read again after a permission grant or a pull-to-refresh, while the app is active. */
export function refreshDeviceLocation(): Promise<void> {
  if (AppState.currentState !== 'active') return Promise.resolve();
  return session.onForeground();
}

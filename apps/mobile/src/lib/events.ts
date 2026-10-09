import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { api, throwIfError } from './api';

export const FALLBACK_CENTER = {
  lat: 61.3037,
  lng: 17.0592,
  radiusM: 50_000,
} as const;

/** Web geolocation/permission prompts often hang until the tab is focused again. */
const LOCATION_TIMEOUT_MS = Platform.OS === 'web' ? 2_000 : 8_000;

export type EventQueryPoint = {
  lat: number;
  lng: number;
  radiusM: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function resolveEventQueryPoint(): Promise<EventQueryPoint> {
  try {
    return await withTimeout(
      (async (): Promise<EventQueryPoint> => {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          return { ...FALLBACK_CENTER };
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          radiusM: FALLBACK_CENTER.radiusM,
        };
      })(),
      LOCATION_TIMEOUT_MS,
    );
  } catch {
    return { ...FALLBACK_CENTER };
  }
}

export async function listPublicEvents(point: EventQueryPoint) {
  return throwIfError(
    await api.GET('/events', {
      params: {
        query: {
          lat: point.lat,
          lng: point.lng,
          radiusM: point.radiusM,
        },
      },
    }),
  );
}

export async function getPublicEvent(id: string) {
  return throwIfError(
    await api.GET('/events/{id}', {
      params: { path: { id } },
    }),
  );
}

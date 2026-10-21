import * as Location from 'expo-location';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export async function fetchCheckInStatus(identity: StoredIdentity, eventId: string) {
  return throwIfError(
    await api.GET('/events/{eventId}/check-in', {
      params: { path: { eventId } },
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
}

/**
 * High-accuracy foreground check-in at the venue. Throws ApiError / permission errors.
 */
export async function performGeoCheckIn(identity: StoredIdentity, eventId: string) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('location_permission_denied');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return throwIfError(
    await api.POST('/events/{eventId}/check-ins', {
      params: { path: { eventId } },
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      body: {
        location: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        },
        accuracyM: position.coords.accuracy ?? 999,
      },
    }),
  );
}

/** Venue QR / digital rotating code check-in. */
export async function performCodeCheckIn(identity: StoredIdentity, eventId: string, code: string) {
  return throwIfError(
    await api.POST('/events/{eventId}/check-ins/code', {
      params: { path: { eventId } },
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      body: { code },
    }),
  );
}

/** Newest check-ins, newest first, including events that have already ended. */
export async function listMyCheckIns(identity: StoredIdentity) {
  return throwIfError(
    await api.GET('/me/check-ins', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
    }),
  );
}

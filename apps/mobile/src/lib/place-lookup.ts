import * as Location from 'expo-location';

import { api, throwIfError } from './api';
import { placeLabelFromGeocode } from './place-name';

export type NamedPlace = {
  name: string;
  lat: number;
  lng: number;
};

/** Covering region name, then the device geocoder's locality. */
export async function placeNameAt(lat: number, lng: number): Promise<string | null> {
  try {
    const lookup = throwIfError(
      await api.GET('/regions/lookup', {
        params: { query: { lat, lng } },
      }),
    );
    const regionName = lookup.region?.name?.trim();
    if (regionName) return regionName;
  } catch {
    // Fall through to the device geocoder.
  }
  try {
    const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return placeLabelFromGeocode(places[0]);
  } catch {
    return null;
  }
}

/**
 * Forward-geocode a query and label each hit.
 * The coordinates are the geocoder's point for that place.
 */
export async function searchPlaces(query: string, limit = 4): Promise<NamedPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const hits = await Location.geocodeAsync(trimmed);
  const places: NamedPlace[] = [];
  console.log('searchPlaces', trimmed, hits);
  for (const hit of hits) {
    if (places.length >= limit) break;
    let geocoded: string | null = null;
    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude: hit.latitude,
        longitude: hit.longitude,
      });
      geocoded = placeLabelFromGeocode(addresses[0]);
    } catch {
      geocoded = null;
    }
    if (!geocoded) continue;
    const name = geocoded;
    const duplicate = places.some(
      (place) =>
        place.name === name &&
        Math.abs(place.lat - hit.latitude) < 0.02 &&
        Math.abs(place.lng - hit.longitude) < 0.02,
    );
    if (duplicate) continue;
    places.push({ name, lat: hit.latitude, lng: hit.longitude });
  }
  return places;
}

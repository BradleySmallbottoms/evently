import { queryPointForArea } from './area-point';

type PlaceArea = Parameters<typeof queryPointForArea>[0] & { id: string };

/** Search point for a location-menu draft. Nearby uses the device fix. */
export function pointForPlace(
  placeId: string,
  radiusM: number,
  nearbyPlaceId: string,
  areas: readonly PlaceArea[],
  device: { lat: number; lng: number } | null,
): { lat: number; lng: number; radiusM: number } | null {
  if (placeId === nearbyPlaceId) {
    if (!device) return null;
    return { lat: device.lat, lng: device.lng, radiusM };
  }
  const area = areas.find((item) => item.id === placeId);
  if (!area) return null;
  const point = queryPointForArea(area);
  if (!point) return null;
  return { lat: point.lat, lng: point.lng, radiusM };
}

/**
 * Tags the home list will use after the location menu applies a place.
 * The same place keeps the tags on screen. Another place uses that place's saved tags.
 */
export function tagsForLocationDraft(input: {
  draftPlaceId: string;
  currentPlaceId: string;
  nearbyPlaceId: string;
  currentTagIds: readonly string[];
  nearbyTagIds: readonly string[];
  areaTagIds: readonly string[];
}): string[] {
  if (input.draftPlaceId === input.currentPlaceId) return [...input.currentTagIds];
  if (input.draftPlaceId === input.nearbyPlaceId) return [...input.nearbyTagIds];
  return [...input.areaTagIds];
}

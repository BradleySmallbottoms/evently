import { NEARBY_PLACE_ID } from './discovery-place-id';

/** About 1 km. GPS jitter inside one cell keeps the same place name. */
const PLACE_NAME_CELL = 100;

export function placeNameCell(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat * PLACE_NAME_CELL) / PLACE_NAME_CELL,
    lng: Math.round(lng * PLACE_NAME_CELL) / PLACE_NAME_CELL,
  };
}

/** Locality shown under “Near you”. Saved places already use their own name as the label. */
export function nearbyLocationDetail(
  placeId: string,
  name: string | null | undefined,
): string | undefined {
  if (placeId !== NEARBY_PLACE_ID) return undefined;
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

/** Address fields returned by the platform geocoder. */
export type GeocodedPlace = {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  name?: string | null;
};

/**
 * Locality label for a reverse-geocoded point.
 * Prefer the city, then a district, then the wider administrative names.
 */
export function placeLabelFromGeocode(place: GeocodedPlace | null | undefined): string | null {
  if (!place) return null;
  for (const value of [place.city, place.district, place.subregion, place.region, place.name]) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** A suggestion whose name is the whole typed string, ignoring case. */
export function matchingPlace<T extends { name: string }>(query: string, places: T[]): T | null {
  const typed = query.trim().toLocaleLowerCase('sv');
  if (!typed) return null;
  return places.find((place) => place.name.trim().toLocaleLowerCase('sv') === typed) ?? null;
}

export interface VenueIdentity {
  name: string;
  city: string;
  nameKey: string;
  cityKey: string;
}

/**
 * The venue row is the name plus the city. A name that is only the city is
 * not a venue. Keys are trimmed, collapsed, and lowercased so a later lookup
 * matches the stored row.
 */
export function venueIdentity(
  name: string | null | undefined,
  city: string | null | undefined,
): VenueIdentity | undefined {
  const place = placeText(name, 500);
  const town = placeText(city, 80);
  if (!place || !town) return undefined;
  const nameKey = place.toLocaleLowerCase('sv');
  const cityKey = town.toLocaleLowerCase('sv');
  if (nameKey === cityKey) return undefined;
  return { name: place, city: town, nameKey, cityKey };
}

function placeText(value: string | null | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return undefined;
  return text;
}

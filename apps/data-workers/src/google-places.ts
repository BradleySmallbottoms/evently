/**
 * Places API (New) text search. The key stays in `GOOGLE_PLACES_API_KEY`.
 * A hit is kept only when the place is in Sweden and in the town we asked for.
 */

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

export interface PlacePoint {
  lat: number;
  lng: number;
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** First Swedish place whose town matches `city`. A miss is undefined. */
export function pointFromPlacesResponse(body: unknown, city: string): PlacePoint | undefined {
  if (!body || typeof body !== 'object' || !('places' in body)) return undefined;
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return undefined;
  const wanted = city.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv');
  if (!wanted) return undefined;
  for (const place of places) {
    const point = readPlace(place, wanted);
    if (point) return point;
  }
  return undefined;
}

function readPlace(place: unknown, cityKey: string): PlacePoint | undefined {
  if (!place || typeof place !== 'object') return undefined;
  const record = place as {
    location?: { latitude?: unknown; longitude?: unknown };
    addressComponents?: unknown;
  };
  const lat = record.location?.latitude;
  const lng = record.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  const components = Array.isArray(record.addressComponents)
    ? (record.addressComponents as AddressComponent[])
    : [];
  if (!inSweden(components) || !inCity(components, cityKey)) return undefined;
  return { lat, lng };
}

function inSweden(components: AddressComponent[]): boolean {
  return components.some((component) => {
    if (!component.types?.includes('country')) return false;
    const short = component.shortText?.toUpperCase();
    const long = component.longText?.toLocaleLowerCase('sv');
    return short === 'SE' || long === 'sweden' || long === 'sverige';
  });
}

function inCity(components: AddressComponent[], cityKey: string): boolean {
  return components.some((component) => {
    const types = component.types ?? [];
    const town = types.includes('locality') || types.includes('postal_town');
    if (!town) return false;
    return component.longText?.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv') === cityKey;
  });
}

export async function googlePlacePoint(
  name: string,
  city: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<PlacePoint | undefined> {
  const query = `${name}, ${city}, Sweden`.slice(0, 300);
  const response = await fetchImpl(PLACES_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.location,places.addressComponents',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'sv',
      regionCode: 'SE',
      pageSize: 5,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  return pointFromPlacesResponse(await response.json(), city);
}

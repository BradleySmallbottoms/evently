import {
  canGeocodeAddress,
  nearestCityName,
  NEARBY_CITY_RADIUS_KM,
  type EventAddressParts,
  type ReversePlace,
} from '@local-events/domain';

/**
 * The one https page the scan may open. Source URL, then a ticket link, then an
 * info link, then a Facebook page. An info link on facebook.com counts as Facebook.
 */
export function lookupPageUrl(
  links: { type: string; url: string }[] | undefined,
  sourceUrl?: string | null,
): string | undefined {
  if (sourceUrl?.startsWith('https://') && !isFacebookUrl(sourceUrl)) return sourceUrl;
  const pages = links ?? [];
  const ticket = pages.find(
    (link) =>
      link.type === 'tickets' && link.url.startsWith('https://') && !isFacebookUrl(link.url),
  );
  if (ticket) return ticket.url;
  const info = pages.find(
    (link) => link.type === 'info' && link.url.startsWith('https://') && !isFacebookUrl(link.url),
  );
  if (info) return info.url;
  return pages.find((link) => link.url.startsWith('https://') && isFacebookPage(link))?.url;
}

function isFacebookPage(link: { type: string; url: string }): boolean {
  return link.type === 'facebook' || isFacebookUrl(link.url);
}

function isFacebookUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.com' ||
      host.endsWith('.fb.com')
    );
  } catch {
    return false;
  }
}

const PHOTON_URL = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE_URL = 'https://photon.komoot.io/reverse';
/** Used when Photon does not answer. One request per second, and a User-Agent is required. */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_USER_AGENT = 'LocalEvents/1.0 (event geocoding)';
/**
 * Keyed geocoders that can replace Photon or Nominatim when a key is configured:
 * OpenCage, Geoapify, LocationIQ, and Mapbox. None of those keys is read here.
 */
const NOMINATIM_GAP_MS = 1_100;

let lastNominatimAt = 0;
const reverseCityCache = new Map<string, string | null>();

/**
 * City at a point, within 25 km. Photon is tried first. Nominatim is used when
 * Photon does not answer or returns no Swedish city.
 */
export async function cityFromPoint(
  location: { lat: number; lng: number },
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const key = `${location.lat.toFixed(3)},${location.lng.toFixed(3)}`;
  const cached = reverseCityCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const photon = await photonCity(location, fetchImpl);
  const city = photon.city ?? (await nominatimCity(location, fetchImpl));
  reverseCityCache.set(key, city ?? null);
  return city;
}

/**
 * Address lookup for a point the import did not store. A street, or a postcode
 * with a city, is queried first. A city alone is used when nothing more specific
 * exists or that lookup finds nothing in Sweden. Photon is tried first. Nominatim
 * is used when Photon does not answer. An empty Photon result is a miss, not an outage.
 */
export async function geocodeSwedishAddress(
  parts: EventAddressParts,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  const specific = canGeocodeAddress(parts)
    ? await geocodeQuery([parts.address, parts.zipCode, parts.city, 'Sweden'], fetchImpl)
    : undefined;
  if (specific) return specific;
  const city = cityName(parts.city);
  if (!city) return undefined;
  return geocodeQuery([city, 'Sweden'], fetchImpl);
}

async function geocodeQuery(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  const photon = await photonPoint(parts, fetchImpl);
  if (photon.down) return nominatimPoint(parts, fetchImpl);
  return photon.point;
}

function cityName(value: string | null | undefined): string | undefined {
  const city = value?.replace(/\s+/g, ' ').trim();
  if (!city || city.length > 80) return undefined;
  return city;
}

async function photonPoint(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
): Promise<{ point?: { lat: number; lng: number }; down: boolean }> {
  const query = parts.filter(Boolean).join(', ');
  if (!query) return { down: false };
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  try {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { down: true };
    }
    return { point: swedishPoint(await response.json()), down: false };
  } catch {
    return { down: true };
  }
}

async function photonCity(
  location: { lat: number; lng: number },
  fetchImpl: typeof fetch,
): Promise<{ city?: string; down: boolean }> {
  const url = new URL(PHOTON_REVERSE_URL);
  url.searchParams.set('lat', String(location.lat));
  url.searchParams.set('lon', String(location.lng));
  url.searchParams.set('lang', 'sv');
  url.searchParams.set('limit', '5');
  url.searchParams.set('radius', String(NEARBY_CITY_RADIUS_KM));
  try {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { down: true };
    }
    return { city: nearestCityName(photonPlaces(await response.json())) ?? undefined, down: false };
  } catch {
    return { down: true };
  }
}

async function nominatimCity(
  location: { lat: number; lng: number },
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  await waitForNominatim();
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(location.lat));
  url.searchParams.set('lon', String(location.lng));
  url.searchParams.set('format', 'jsonv2');
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': GEOCODE_USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    return cityFromNominatim(await response.json());
  } catch {
    return undefined;
  }
}

function photonPlaces(body: unknown): ReversePlace[] {
  if (!body || typeof body !== 'object' || !('features' in body)) return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object' || !('properties' in feature)) return [];
    const properties = feature.properties;
    if (!properties || typeof properties !== 'object') return [];
    const record = properties as Record<string, unknown>;
    const text = (name: string) => (typeof record[name] === 'string' ? record[name] : undefined);
    return [
      {
        ...(text('city') ? { city: text('city') } : {}),
        ...(text('locality') ? { locality: text('locality') } : {}),
        ...(text('name') ? { name: text('name') } : {}),
        ...(text('type') ? { kind: text('type') } : {}),
        ...(text('countrycode') ? { countryCode: text('countrycode') } : {}),
      },
    ];
  });
}

function cityFromNominatim(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('address' in body)) return undefined;
  const address = (body as { address?: unknown }).address;
  if (!address || typeof address !== 'object') return undefined;
  const record = address as Record<string, unknown>;
  const text = (name: string) => (typeof record[name] === 'string' ? record[name] : undefined);
  return (
    nearestCityName([
      {
        ...(text('country_code') ? { countryCode: text('country_code') } : {}),
        ...(text('city') || text('town') || text('village') || text('hamlet')
          ? { city: text('city') ?? text('town') ?? text('village') ?? text('hamlet') }
          : {}),
      },
    ]) ?? undefined
  );
}

async function waitForNominatim(): Promise<void> {
  const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
}

async function nominatimPoint(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  const query = parts.filter(Boolean).join(', ');
  if (!query) return undefined;
  await waitForNominatim();
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'se');
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': GEOCODE_USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return undefined;
    const hit = body[0] as { lat?: unknown; lon?: unknown } | undefined;
    return coordinatePair(hit?.lat, hit?.lon);
  } catch {
    return undefined;
  }
}

function swedishPoint(body: unknown): { lat: number; lng: number } | undefined {
  if (!body || typeof body !== 'object' || !('features' in body)) return undefined;
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return undefined;
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const record = feature as {
      geometry?: { coordinates?: unknown };
      properties?: { countrycode?: unknown };
    };
    const country =
      typeof record.properties?.countrycode === 'string' ? record.properties.countrycode : '';
    if (country.toUpperCase() !== 'SE') continue;
    const coordinates = record.geometry?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const point = coordinatePair(coordinates[1], coordinates[0]);
    if (point) return point;
  }
  return undefined;
}

function coordinatePair(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const latitude = typeof lat === 'number' ? lat : Number(lat);
  const longitude = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { lat: latitude, lng: longitude };
}

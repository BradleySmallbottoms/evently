import { canGeocodeAddress, type EventAddressParts } from '@local-events/domain';

/** First ticket https link, otherwise the first info https link. */
export function lookupPageUrl(
  links: { type: string; url: string }[] | undefined,
): string | undefined {
  const ticket = links?.find((link) => link.type === 'tickets' && link.url.startsWith('https://'));
  if (ticket) return ticket.url;
  return links?.find((link) => link.type === 'info' && link.url.startsWith('https://'))?.url;
}

const PHOTON_URL = 'https://photon.komoot.io/api/';

/**
 * Photon lookup for an address the model returned. A street, or a postcode with a
 * city, is queried. Only a hit in Sweden is kept.
 */
export async function geocodeSwedishAddress(
  parts: EventAddressParts,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  if (!canGeocodeAddress(parts)) return undefined;
  const query = [parts.address, parts.zipCode, parts.city, 'Sweden'].filter(Boolean).join(', ');
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return undefined;
    return swedishPoint(await response.json());
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
    const country = typeof record.properties?.countrycode === 'string' ? record.properties.countrycode : '';
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

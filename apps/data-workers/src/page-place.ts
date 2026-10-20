import { canGeocodeAddress, type EventAddressParts } from '@local-events/domain';

/**
 * The one https page the scan may open. Source URL, then a ticket link, then an
 * info link, then a Facebook page. An info link on facebook.com counts as Facebook.
 */
export function lookupPageUrl(
  links: { type: string; url: string }[] | undefined,
  sourceUrl?: string | null,
): string | undefined {
  if (sourceUrl?.startsWith('https://')) return sourceUrl;
  const pages = links ?? [];
  const ticket = pages.find((link) => link.type === 'tickets' && link.url.startsWith('https://'));
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
    return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com');
  } catch {
    return false;
  }
}

const PHOTON_URL = 'https://photon.komoot.io/api/';

/**
 * Photon lookup for an address the model returned. A street, or a postcode with a
 * city, is queried first. A city alone is used when nothing more specific exists or
 * that lookup finds nothing in Sweden.
 */
export async function geocodeSwedishAddress(
  parts: EventAddressParts,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  const specific = canGeocodeAddress(parts)
    ? await photonPoint([parts.address, parts.zipCode, parts.city, 'Sweden'], fetchImpl)
    : undefined;
  if (specific) return specific;
  const city = cityName(parts.city);
  if (!city) return undefined;
  return photonPoint([city, 'Sweden'], fetchImpl);
}

function cityName(value: string | null | undefined): string | undefined {
  const city = value?.replace(/\s+/g, ' ').trim();
  if (!city || city.length > 80) return undefined;
  return city;
}

async function photonPoint(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | undefined> {
  const query = parts.filter(Boolean).join(', ');
  if (!query) return undefined;
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

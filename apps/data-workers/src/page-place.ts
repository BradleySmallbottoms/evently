import {
  canGeocodeAddress,
  houseNumberOf,
  nearestCityName,
  streetVenueName,
  NEARBY_CITY_RADIUS_KM,
  type EventAddressParts,
  type ReversePlace,
} from '@local-events/domain';
import {
  describeGoogleResults,
  googleGeocodeBody,
  googleMapsKey,
  pointFromGoogleGeocode,
  similarGooglePoint,
} from './google-geocode';

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
/** Used when Photon does not answer a reverse lookup. One request per second. */
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

export interface GeocodeCache {
  findCity(city: string): Promise<{ lat: number; lng: number } | undefined>;
  saveCity(city: string, point: { lat: number; lng: number }): Promise<void>;
}

export interface GeocodeOptions {
  /** Set to an empty string to skip Google. Omit it to read the key from the environment. */
  googleKey?: string;
  cache?: GeocodeCache;
  /** One line per lookup step. The scan log shows these to an admin. */
  log?: (line: string) => void;
}

/**
 * Address lookup for a point the import did not store. The best point is the
 * street and its house number. The street name is next. A rooftop Google returns
 * on that street is kept when the result includes a house number. A stored town
 * point does not skip that lookup. The town is last. Google is tried first at
 * each step, then Photon. A different house number is
 * a miss. A place name and a number is kept when Google returns a precise point
 * in that town, including when the name Google uses is only nearly the same.
 * The name does not have to be a street. A town that was stored
 * already is not looked up again.
 */
export async function geocodeSwedishAddress(
  parts: EventAddressParts,
  fetchImpl: typeof fetch,
  options?: GeocodeOptions,
): Promise<{ lat: number; lng: number } | undefined> {
  const specific = await geocodeSwedishStreet(parts, fetchImpl, options);
  if (specific) return specific;
  const city = cityName(parts.city);
  if (!city) {
    note(options, 'No town was left to look up.');
    return undefined;
  }
  return geocodeSwedishCity(city, fetchImpl, options);
}

/** Street geocode. The house number wins, then the street name. The town is separate. */
export async function geocodeSwedishStreet(
  parts: EventAddressParts,
  fetchImpl: typeof fetch,
  options?: GeocodeOptions,
): Promise<{ lat: number; lng: number } | undefined> {
  if (!canGeocodeAddress(parts)) return undefined;
  const city = cityName(parts.city);
  const number = houseNumberOf(parts.address);
  const street = streetWithoutTown(streetLabel(parts.address), city);
  const query = [parts.address, parts.zipCode, city, 'Sweden'];
  const queryText = query.filter(Boolean).join(', ');
  note(options, `Geocode "${queryText}".`);
  const google = await googleBody(query, fetchImpl, options);
  note(options, googleAsked(options, google));
  if (google) {
    for (const line of describeGoogleResults(google)) note(options, line);
  }
  const googleExact = number ? pointFromGoogleGeocode(google, { number, street, city }) : undefined;
  if (googleExact) {
    note(
      options,
      `Kept the Google house ${houseLabel(street, number)} at ${pointText(googleExact)}.`,
    );
    return googleExact;
  }
  if (number) {
    note(options, `Google had no house match for ${street ?? 'the street'} ${number}.`);
  }
  if (!street && parts.address) {
    const premise = pointFromGoogleGeocode(google, {
      city,
      premise: true,
      place: parts.address,
    });
    if (premise) {
      note(
        options,
        `Kept the Google place "${parts.address}" in ${city ?? 'the town'} at ${pointText(premise)}. The name is not a street.`,
      );
      return premise;
    }
    const similar = similarGooglePoint(google, {
      place: parts.address ?? '',
      ...(city ? { city } : {}),
    });
    if (similar) {
      note(
        options,
        `Kept a similar Google place "${parts.address}" in ${city ?? 'the town'} at ${pointText(similar)}. Google calls it "${similar.label}".`,
      );
      return { lat: similar.lat, lng: similar.lng };
    }
    note(options, `Google had no precise place for "${parts.address}" in ${city ?? 'the town'}.`);
  }
  const photon = await photonHits(query, fetchImpl);
  const exact = photon.down ? undefined : exactAddressPoint(photon.hits, number, city, street);
  if (photon.down) note(options, 'Photon did not answer.');
  if (exact) {
    note(options, `Kept the Photon house ${houseLabel(street, number)} at ${pointText(exact)}.`);
    return exact;
  }
  if (number && !photon.down) {
    note(options, `Photon had no house match for ${street ?? 'the street'} ${number}.`);
  }
  const googleStreet = pointFromGoogleGeocode(google, { street, city, streetOnly: true });
  if (googleStreet) {
    note(options, `Kept the Google street ${street} at ${pointText(googleStreet)}.`);
    return googleStreet;
  }
  const googleOnStreet = street
    ? pointFromGoogleGeocode(google, { street, city, onStreet: true })
    : undefined;
  if (googleOnStreet) {
    note(
      options,
      `Kept the Google point on ${street} at ${pointText(googleOnStreet)}. The result includes a house number.`,
    );
    return googleOnStreet;
  }
  if (street) note(options, `Google had no street line for ${street}.`);
  if (photon.down) return undefined;
  const named = streetWithoutNumber(photon.hits, street, city);
  if (named) {
    note(options, `Kept the Photon street ${street} at ${pointText(named)}.`);
    return named;
  }
  if (street) note(options, `Photon had no street line for ${street}.`);
  return undefined;
}

/** Town center. A stored town is returned without a lookup. */
export async function geocodeSwedishCity(
  city: string,
  fetchImpl: typeof fetch,
  options?: GeocodeOptions,
): Promise<{ lat: number; lng: number } | undefined> {
  const name = cityName(city);
  if (!name) return undefined;
  const cached = await options?.cache?.findCity(name);
  if (cached) {
    note(options, `Used the stored town ${name} at ${pointText(cached)}.`);
    return cached;
  }
  note(options, `Geocode the town "${name}".`);
  const googlePoint = await googleCity(name, fetchImpl, options);
  if (googlePoint) {
    note(options, `Kept the Google town ${name} at ${pointText(googlePoint)}.`);
    await options?.cache?.saveCity(name, googlePoint);
    return googlePoint;
  }
  if (!mapsKey(options)) note(options, 'Google was not asked for the town.');
  else note(options, `Google had no town point for ${name}.`);
  const photon = await photonHits([name, 'Sweden'], fetchImpl);
  if (photon.down) note(options, 'Photon did not answer for the town.');
  const point = photon.down ? undefined : cityPointFromHits(photon.hits, name);
  if (point) {
    note(options, `Kept the Photon town ${name} at ${pointText(point)}.`);
    await options?.cache?.saveCity(name, point);
    return point;
  }
  note(options, `No town point for ${name}.`);
  return undefined;
}

/** Reads and stores town points on the ingest store. */
export function cityGeocodeOptions(store: {
  findKnownCity(cityKey: string): Promise<{ lat: number; lng: number } | null>;
  saveKnownCity(input: {
    name: string;
    cityKey: string;
    location: { lat: number; lng: number };
  }): Promise<void>;
}): GeocodeOptions {
  return {
    cache: {
      async findCity(city) {
        const row = await store.findKnownCity(city.toLocaleLowerCase('sv'));
        return row ?? undefined;
      },
      saveCity(city, location) {
        return store.saveKnownCity({
          name: city,
          cityKey: city.toLocaleLowerCase('sv'),
          location,
        });
      },
    },
  };
}

function houseLabel(street: string | undefined, number: string | undefined): string {
  return [street, number].filter(Boolean).join(' ');
}

function note(options: GeocodeOptions | undefined, line: string) {
  options?.log?.(line);
}

function pointText(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

function googleAsked(options: GeocodeOptions | undefined, body: unknown): string {
  if (!mapsKey(options)) return 'Google was not asked.';
  if (!body || typeof body !== 'object' || !('status' in body)) return 'Google did not answer.';
  const status = (body as { status?: unknown }).status;
  const results = (body as { results?: unknown }).results;
  const count = Array.isArray(results) ? results.length : 0;
  if (typeof status !== 'string' || !status) return 'Google did not answer.';
  return `Google status ${status}, ${count} ${count === 1 ? 'result' : 'results'}.`;
}

function cityName(value: string | null | undefined): string | undefined {
  const city = value?.replace(/\s+/g, ' ').trim();
  if (!city || city.length > 80) return undefined;
  return city;
}

interface PhotonHit {
  lat: number;
  lng: number;
  country: string;
  housenumber?: string;
  city?: string;
  name?: string;
  street?: string;
  type?: string;
}

async function photonHits(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
): Promise<{ hits: PhotonHit[]; down: boolean }> {
  const query = parts.filter(Boolean).join(', ');
  if (!query) return { hits: [], down: false };
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
      return { hits: [], down: true };
    }
    return { hits: photonHitList(await response.json()), down: false };
  } catch {
    return { hits: [], down: true };
  }
}

function exactAddressPoint(
  hits: PhotonHit[],
  number: string | undefined,
  city: string | undefined,
  street: string | undefined,
): { lat: number; lng: number } | undefined {
  if (!number) return undefined;
  for (const hit of hits) {
    if (hit.country !== 'SE') continue;
    if (normalizeNumber(hit.housenumber) !== number) continue;
    if (city && hit.city && !samePlace(hit.city, city)) continue;
    if (street && !hitMatchesStreet(hit, street)) continue;
    return { lat: hit.lat, lng: hit.lng };
  }
  return undefined;
}

/** A street in the right town, used when no hit carries the house number. */
function streetWithoutNumber(
  hits: PhotonHit[],
  street: string | undefined,
  city: string | undefined,
): { lat: number; lng: number } | undefined {
  if (!street) return undefined;
  for (const hit of hits) {
    if (hit.country !== 'SE' || hit.type !== 'street' || hit.housenumber) continue;
    if (city && hit.city && !samePlace(hit.city, city)) continue;
    if (!samePlace(hit.name ?? hit.street, street)) continue;
    return { lat: hit.lat, lng: hit.lng };
  }
  return undefined;
}

function hitMatchesStreet(hit: PhotonHit, street: string): boolean {
  if (hit.street) return samePlace(hit.street, street);
  return samePlace(hit.name, street);
}

function streetLabel(address: string | null | undefined): string | undefined {
  const street = streetVenueName(address);
  const label = street?.replace(/\s+\d{1,4}[a-z]?$/i, '').trim();
  return label || undefined;
}

/** `Stationsgatan Kilafors` is the street `Stationsgatan` when the town is Kilafors. */
function streetWithoutTown(
  street: string | undefined,
  city: string | undefined,
): string | undefined {
  if (!street || !city) return street;
  const lowerStreet = street.toLocaleLowerCase('sv');
  const lowerCity = city.toLocaleLowerCase('sv');
  if (!lowerStreet.endsWith(` ${lowerCity}`)) return street;
  const trimmed = street.slice(0, street.length - city.length).trim();
  return trimmed || undefined;
}

function cityPointFromHits(
  hits: PhotonHit[],
  city: string,
): { lat: number; lng: number } | undefined {
  const swedish = hits.filter((hit) => hit.country === 'SE');
  const town = swedish.find(
    (hit) =>
      hit.type === 'city' ||
      hit.type === 'locality' ||
      samePlace(hit.name, city) ||
      samePlace(hit.city, city),
  );
  const chosen = town ?? swedish[0];
  return chosen ? { lat: chosen.lat, lng: chosen.lng } : undefined;
}

function photonHitList(body: unknown): PhotonHit[] {
  if (!body || typeof body !== 'object' || !('features' in body)) return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const hits: PhotonHit[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const record = feature as {
      geometry?: { coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const coordinates = record.geometry?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const point = coordinatePair(coordinates[1], coordinates[0]);
    if (!point) continue;
    const text = (name: string) => {
      const value = record.properties?.[name];
      return typeof value === 'string' ? value : undefined;
    };
    hits.push({
      ...point,
      country: text('countrycode')?.toUpperCase() ?? '',
      ...(text('housenumber') ? { housenumber: text('housenumber') } : {}),
      ...(text('city') ? { city: text('city') } : {}),
      ...(text('name') ? { name: text('name') } : {}),
      ...(text('street') ? { street: text('street') } : {}),
      ...(text('type') ? { type: text('type') } : {}),
    });
  }
  return hits;
}

function mapsKey(options?: GeocodeOptions): string | undefined {
  if (options && 'googleKey' in options) return options.googleKey || undefined;
  return googleMapsKey();
}

async function googleBody(
  parts: Array<string | null | undefined>,
  fetchImpl: typeof fetch,
  options?: GeocodeOptions,
): Promise<unknown> {
  const key = mapsKey(options);
  const query = parts.filter(Boolean).join(', ');
  if (!key || !query) return undefined;
  try {
    return await googleGeocodeBody(query, fetchImpl, key);
  } catch {
    return undefined;
  }
}

async function googleCity(
  city: string,
  fetchImpl: typeof fetch,
  options?: GeocodeOptions,
): Promise<{ lat: number; lng: number } | undefined> {
  const key = mapsKey(options);
  if (!key) return undefined;
  try {
    const body = await googleGeocodeBody(`${city}, Sweden`, fetchImpl, key);
    if (body) {
      for (const line of describeGoogleResults(body)) note(options, line);
    }
    return pointFromGoogleGeocode(body, { city, cityOnly: true });
  } catch {
    return undefined;
  }
}

function normalizeNumber(value: string | undefined): string {
  return value?.replace(/\s+/g, '').toLocaleLowerCase('sv') ?? '';
}

function samePlace(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv') === right.toLocaleLowerCase('sv');
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

function coordinatePair(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const latitude = typeof lat === 'number' ? lat : Number(lat);
  const longitude = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { lat: latitude, lng: longitude };
}

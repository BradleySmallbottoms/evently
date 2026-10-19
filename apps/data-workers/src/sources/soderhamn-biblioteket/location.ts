/**
 * A library page has no map point. Look the place up on the public Photon
 * geocoder, biased toward Söderhamn. The library itself is a known point from
 * OpenStreetMap (Söderhamns stadsbibliotek, Köpmangatan) used when that lookup misses.
 */

/** Söderhamns stadsbibliotek, Köpmangatan. */
export const SODERHAMN_LIBRARY_LOCATION = { lat: 61.3023668, lng: 17.0549701 };

const PHOTON_URL = 'https://photon.komoot.io/api/';
const AREA = { south: 61.12, north: 61.55, west: 16.75, east: 17.4 };
const LOCALITY_TOKENS = new Set([
  'söderhamn',
  'bergvik',
  'ljusne',
  'marmaverken',
  'sandarne',
  'söderala',
  'trönö',
  'mohed',
  'stråtjära',
  'vallvik',
  'sweden',
  'sverige',
]);

export interface BibliotekLocationInput {
  id?: string;
  venueName?: string;
  address?: string;
  city?: string;
}

export interface LocationLookupState {
  cache: Map<string, { lat: number; lng: number } | null>;
  lastAt: number;
}

interface LookupOptions {
  delayMs: number;
  state: LocationLookupState;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

interface PhotonFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    countrycode?: string;
  };
}

export function createLocationLookupState(): LocationLookupState {
  return { cache: new Map(), lastAt: 0 };
}

/** The library building, not a talk that only mentions the town. */
export function isLibraryPlace(input: BibliotekLocationInput): boolean {
  const text = [input.venueName, input.address, input.city]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('sv');
  return text.includes('stadsbibliotek') || text.includes('köpmangatan 11');
}

export function bibliotekLocationQueries(input: BibliotekLocationInput): string[] {
  if (isLibraryPlace(input)) return ['Söderhamns stadsbibliotek, Söderhamn'];
  const city = input.city?.trim() || 'Söderhamn';
  const queries: string[] = [];
  const add = (value: string | undefined) => {
    const text = value?.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    const withCity = text.toLocaleLowerCase('sv').includes(city.toLocaleLowerCase('sv'))
      ? text
      : `${text}, ${city}`;
    if (queries.some((query) => query.toLocaleLowerCase('sv') === withCity.toLocaleLowerCase('sv')))
      return;
    queries.push(withCity.slice(0, 180));
  };
  add(input.venueName);
  add(input.address);
  return queries;
}

/**
 * Library places use the geocoder, then the library point. Another venue stays
 * without a point when the lookup misses.
 */
export async function resolveBibliotekLocation(
  input: BibliotekLocationInput,
  fetchImpl: typeof fetch,
  options: LookupOptions,
): Promise<{ lat: number; lng: number } | undefined> {
  const library = isLibraryPlace(input);
  for (const text of bibliotekLocationQueries(input)) {
    const point = await geocode(text, fetchImpl, options);
    if (!point) continue;
    options.log?.('soderhamn-biblioteket location', { id: input.id, via: 'geocode' });
    return point;
  }
  if (!library) return undefined;
  options.log?.('soderhamn-biblioteket location', { id: input.id, via: 'library' });
  return SODERHAMN_LIBRARY_LOCATION;
}

async function geocode(
  text: string,
  fetchImpl: typeof fetch,
  options: LookupOptions,
): Promise<{ lat: number; lng: number } | null> {
  const key = text.toLocaleLowerCase('sv');
  const cached = options.state.cache.get(key);
  if (cached !== undefined) return cached;
  await pause(options);
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', text);
  url.searchParams.set('lat', String(SODERHAMN_LIBRARY_LOCATION.lat));
  url.searchParams.set('lon', String(SODERHAMN_LIBRARY_LOCATION.lng));
  url.searchParams.set('limit', '5');
  url.searchParams.set('bbox', `${AREA.west},${AREA.south},${AREA.east},${AREA.north}`);
  let point: { lat: number; lng: number } | null = null;
  try {
    const response = await fetchImpl(url);
    if (!response.ok || !samePhotonHost(response, url)) {
      options.state.cache.set(key, null);
      return null;
    }
    point = pointFromPhoton(await response.json(), text);
  } catch {
    options.state.cache.set(key, null);
    return null;
  }
  options.state.cache.set(key, point);
  return point;
}

function samePhotonHost(response: Response, request: URL): boolean {
  if (!response.url) return true;
  try {
    const url = new URL(response.url);
    return url.protocol === 'https:' && url.hostname === 'photon.komoot.io';
  } catch {
    return request.hostname === 'photon.komoot.io';
  }
}

function pointFromPhoton(body: unknown, query: string): { lat: number; lng: number } | null {
  let best: { score: number; lat: number; lng: number } | null = null;
  for (const feature of photonFeatures(body)) {
    const coordinates = feature.geometry?.coordinates;
    const lng = coordinates?.[0];
    const lat = coordinates?.[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inArea(lat, lng)) continue;
    const country = feature.properties?.countrycode;
    if (country && country.toUpperCase() !== 'SE') continue;
    const score = scoreFeature(query, feature);
    if (score < 20) continue;
    if (!best || score > best.score) best = { score, lat, lng };
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

function photonFeatures(body: unknown): PhotonFeature[] {
  if (!body || typeof body !== 'object' || !('features' in body)) return [];
  const features = (body as { features?: unknown }).features;
  return Array.isArray(features) ? (features as PhotonFeature[]) : [];
}

function inArea(lat: number, lng: number): boolean {
  return lat >= AREA.south && lat <= AREA.north && lng >= AREA.west && lng <= AREA.east;
}

function tokensOf(value: string): string[] {
  return value
    .toLocaleLowerCase('sv')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4 && !LOCALITY_TOKENS.has(token) && !/^\d+$/.test(token));
}

/** Prefer the named building over the street midpoint. */
function scoreFeature(query: string, feature: PhotonFeature): number {
  const name = feature.properties?.name?.trim() ?? '';
  const street = feature.properties?.street?.trim() ?? '';
  const number = feature.properties?.housenumber?.trim() ?? '';
  const wanted = tokensOf(query);
  const found = tokensOf([name, street].filter(Boolean).join(' '));
  const nameHit = wanted.some((left) =>
    found.some((right) => left.includes(right) || right.includes(left)),
  );
  if (!nameHit && wanted.length > 0) return 0;
  const library = /bibliotek/i.test(query) && /bibliotek/i.test(name);
  const askedNumber = query.match(/\b(\d+[a-zA-Z]?)\b/)?.[1];
  if (askedNumber && number && number !== askedNumber) return 0;
  let score = nameHit ? 20 : 0;
  if (library) score += 100;
  if (askedNumber && number === askedNumber) score += 80;
  if (name && street && name.toLocaleLowerCase('sv') !== street.toLocaleLowerCase('sv'))
    score += 30;
  return score;
}

async function pause(options: LookupOptions): Promise<void> {
  if (options.delayMs <= 0) {
    options.state.lastAt = Date.now();
    return;
  }
  const wait = options.state.lastAt + options.delayMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  options.state.lastAt = Date.now();
}

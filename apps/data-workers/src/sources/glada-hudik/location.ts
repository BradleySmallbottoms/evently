/**
 * When a Glada Hudik page has no map point, look up a coordinate and otherwise
 * use Hudiksvall centre. The public Photon geocoder is biased toward that town.
 * A hit counts only inside Hudiksvall municipality (including Bjuråker, Delsbo,
 * and Iggesund).
 */

/** Hudiksvall locality centre. */
export const GLADA_HUDIK_DEFAULT_LOCATION = { lat: 61.728161, lng: 17.105575 };

const PHOTON_URL = 'https://photon.komoot.io/api/';
const AREA = { south: 61.4, north: 62.1, west: 16.2, east: 17.75 };
const LOCALITY_PATTERN =
  /hudiksvall|bjuråker|delsbo|iggesund|enånger|näsviken|njutånger|sörforsa|hålsjö|rogsta/i;
const LOCALITY_TOKENS = new Set([
  'hudiksvall',
  'bjuråker',
  'delsbo',
  'iggesund',
  'enånger',
  'näsviken',
  'njutånger',
  'sörforsa',
  'hålsjö',
  'rogsta',
  'sweden',
  'sverige',
]);

export interface GladaLocationInput {
  id?: string;
  placeName?: string;
  address?: string;
  city?: string;
  location?: { lat: number; lng: number };
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

type LookupStep = 'pin' | 'contact' | 'city';

interface PhotonFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    postcode?: string;
    district?: string;
    countrycode?: string;
  };
}

export function createLocationLookupState(): LocationLookupState {
  return { cache: new Map(), lastAt: 0 };
}

export function geocodeDelayMs(config: Record<string, unknown>): number {
  const raw = config.geocodeDelayMs ?? 1_000;
  const ms = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) return 1_000;
  return ms;
}

/** Pin, then contact address, then contact town. Duplicate text is skipped. */
export function gladaLocationQueries(
  input: GladaLocationInput,
): { step: LookupStep; text: string }[] {
  const queries: { step: LookupStep; text: string }[] = [];
  const add = (step: LookupStep, value: string | undefined) => {
    const text = value?.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    if (
      queries.some((query) => query.text.toLocaleLowerCase('sv') === text.toLocaleLowerCase('sv'))
    )
      return;
    queries.push({ step, text: text.slice(0, 180) });
  };
  const place = input.placeName?.trim();
  if (place && place.toLocaleLowerCase('sv') !== 'digitalt') {
    add('pin', place);
    if (!LOCALITY_PATTERN.test(place) && !/\d{3}\s?\d{2}/.test(place)) {
      add('pin', `${place}, ${input.city?.trim() || 'Hudiksvall'}`);
    }
  }
  add('contact', input.address);
  add('city', input.city);
  return queries;
}

/**
 * Map point wins. Otherwise the first in-area geocode hit, then Hudiksvall centre.
 * A page that already has a point does not call the geocoder.
 */
export async function resolveGladaLocation(
  input: GladaLocationInput,
  fetchImpl: typeof fetch,
  options: LookupOptions,
): Promise<{ lat: number; lng: number }> {
  if (input.location) return input.location;
  for (const query of gladaLocationQueries(input)) {
    const point = await geocode(query, fetchImpl, options);
    if (!point) continue;
    options.log?.('glada-hudik location', { id: input.id, via: query.step });
    return point;
  }
  options.log?.('glada-hudik location', { id: input.id, via: 'default' });
  return GLADA_HUDIK_DEFAULT_LOCATION;
}

async function geocode(
  query: { step: LookupStep; text: string },
  fetchImpl: typeof fetch,
  options: LookupOptions,
): Promise<{ lat: number; lng: number } | null> {
  const key = `${query.step}:${query.text.toLocaleLowerCase('sv')}`;
  const cached = options.state.cache.get(key);
  if (cached !== undefined) return cached;
  await pause(options);
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query.text);
  url.searchParams.set('lat', String(GLADA_HUDIK_DEFAULT_LOCATION.lat));
  url.searchParams.set('lon', String(GLADA_HUDIK_DEFAULT_LOCATION.lng));
  url.searchParams.set('limit', '5');
  url.searchParams.set('bbox', `${AREA.west},${AREA.south},${AREA.east},${AREA.north}`);
  let point: { lat: number; lng: number } | null = null;
  try {
    const response = await fetchImpl(url);
    if (!response.ok || !samePhotonHost(response, url)) {
      options.state.cache.set(key, null);
      return null;
    }
    point = pointFromPhoton(await response.json(), query);
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

function pointFromPhoton(
  body: unknown,
  query: { step: LookupStep; text: string },
): { lat: number; lng: number } | null {
  const features = photonFeatures(body);
  for (const feature of features) {
    const coordinates = feature.geometry?.coordinates;
    const lng = coordinates?.[0];
    const lat = coordinates?.[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inArea(lat, lng)) continue;
    const country = feature.properties?.countrycode;
    if (country && country.toUpperCase() !== 'SE') continue;
    if (!accepts(query, feature)) continue;
    return { lat, lng };
  }
  return null;
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
    .filter((token) => token.length >= 4);
}

/** Pin and street hits must match the venue or street, not only the town name. */
function accepts(query: { step: LookupStep; text: string }, feature: PhotonFeature): boolean {
  const name = feature.properties?.name?.trim().toLocaleLowerCase('sv') ?? '';
  if (query.step === 'city') {
    const city = query.text.trim().toLocaleLowerCase('sv');
    return name === city || name.startsWith(city);
  }
  const wanted = tokensOf(query.text).filter(
    (token) => !LOCALITY_TOKENS.has(token) && !/^\d+$/.test(token),
  );
  const found = tokensOf(
    [feature.properties?.name, feature.properties?.street].filter(Boolean).join(' '),
  );
  if (wanted.length === 0)
    return found.length > 0 && name.startsWith(query.text.trim().toLocaleLowerCase('sv'));
  return wanted.some((left) => found.some((right) => left.includes(right) || right.includes(left)));
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

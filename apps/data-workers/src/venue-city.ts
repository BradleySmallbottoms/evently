import {
  cityFromAddress,
  nearestCityName,
  NEARBY_CITY_RADIUS_KM,
  type ReversePlace,
} from '@local-events/domain';
import type { IncomingEvent } from '@local-events/ingest';

const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';

interface LookupState {
  cache: Map<string, string | null>;
  lastAt: number;
}

export interface VenueCityOptions {
  delayMs: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

/** Same `geocodeDelayMs` config as the Glada Hudik geocoder. Out of range is one second. */
export function geocodeDelayMs(config: Record<string, unknown>): number {
  const raw = config.geocodeDelayMs ?? 1_000;
  const ms = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) return 1_000;
  return ms;
}

/**
 * A physical event with no venue name takes the city from its address.
 * When that address has no city, the point is reverse-geocoded.
 * A named venue, a digital event, and a failed lookup stay as they are.
 */
export async function fillMissingVenueNames(
  events: IncomingEvent[],
  fetchImpl: typeof fetch,
  options: VenueCityOptions,
): Promise<IncomingEvent[]> {
  const state: LookupState = { cache: new Map(), lastAt: 0 };
  const named: IncomingEvent[] = [];
  for (const event of events) {
    named.push(await fillOne(event, fetchImpl, state, options));
  }
  return named;
}

async function fillOne(
  event: IncomingEvent,
  fetchImpl: typeof fetch,
  state: LookupState,
  options: VenueCityOptions,
): Promise<IncomingEvent> {
  if (event.mode === 'digital' || event.venueName?.trim()) return event;
  const fromAddress = cityFromAddress(event.address);
  if (fromAddress) {
    options.log?.('venue city', {
      externalId: event.externalId,
      via: 'address',
      city: fromAddress,
    });
    return { ...event, venueName: fromAddress };
  }
  if (!event.location) return event;
  const city = await reverseCity(event.location, event.externalId, fetchImpl, state, options);
  return city ? { ...event, venueName: city } : event;
}

async function reverseCity(
  location: { lat: number; lng: number },
  externalId: string,
  fetchImpl: typeof fetch,
  state: LookupState,
  options: VenueCityOptions,
): Promise<string | null> {
  const key = `${location.lat.toFixed(3)},${location.lng.toFixed(3)}`;
  const cached = state.cache.get(key);
  if (cached !== undefined) return cached;
  await pause(state, options.delayMs);
  const url = new URL(PHOTON_REVERSE);
  url.searchParams.set('lat', String(location.lat));
  url.searchParams.set('lon', String(location.lng));
  url.searchParams.set('lang', 'sv');
  url.searchParams.set('limit', '5');
  url.searchParams.set('radius', String(NEARBY_CITY_RADIUS_KM));
  let city: string | null = null;
  let answered = false;
  try {
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok && samePhotonHost(response, url)) {
      city = nearestCityName(placesFromPhoton(await response.json()));
      answered = true;
    }
  } catch {
    answered = false;
  }
  if (answered) state.cache.set(key, city);
  options.log?.('venue city', {
    externalId,
    via: 'reverse',
    city,
    lat: location.lat,
    lng: location.lng,
  });
  return city;
}

function placesFromPhoton(body: unknown): ReversePlace[] {
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

function samePhotonHost(response: Response, request: URL): boolean {
  if (!response.url) return true;
  try {
    const url = new URL(response.url);
    return url.protocol === 'https:' && url.hostname === 'photon.komoot.io';
  } catch {
    return request.hostname === 'photon.komoot.io';
  }
}

async function pause(state: LookupState, delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    state.lastAt = Date.now();
    return;
  }
  const wait = state.lastAt + delayMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  state.lastAt = Date.now();
}

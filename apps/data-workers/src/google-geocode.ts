/**
 * Google Geocoding API. The key is `GOOGLE_MAPS_API_KEY`, or
 * `GOOGLE_PLACES_API_KEY` when that is the key the project already has.
 * The best hit is the street and its house number. The street name is next.
 * A city hit has to be that town. A close place is kept when the town matches
 * and the name and house number are nearly the same. A different house number
 * is still a miss.
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export interface GeocodePoint {
  lat: number;
  lng: number;
}

/** A precise Google place that is close to the address, plus what Google called it. */
export interface SimilarGooglePoint extends GeocodePoint {
  label: string;
}

export interface GoogleGeocodeWanted {
  number?: string;
  /** Street name, without the house number. */
  street?: string;
  city?: string;
  /** Town center. A house number is not required. */
  cityOnly?: boolean;
  /** A precise place in the town. The name does not have to be a street. */
  premise?: boolean;
  /** Address text that has to appear on a premise hit, such as `Sågtäkten 354`. */
  place?: string;
  /** The street itself. A house number on the result is left out. */
  streetOnly?: boolean;
  /** A precise point on the street. A house number Google found is kept. */
  onStreet?: boolean;
}

export function googleMapsKey(): string | undefined {
  const maps = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (maps) return maps;
  const places = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return places || undefined;
}

/**
 * One line per Google place, for the scan log. The request URL, the key, and
 * `error_message` are left out. At most three places are listed.
 */
export function describeGoogleResults(body: unknown): string[] {
  const results = googleResults(body);
  if (results.length === 0) return body ? ['Google returned no places.'] : [];
  const lines = results.slice(0, 3).map((result, index) => {
    const address = clip(result.formatted, 140) || 'no address';
    const parts = [
      result.route ? `route ${result.route}` : '',
      result.number ? `number ${result.number}` : '',
      result.town ? `town ${result.town}` : '',
      result.locationType || 'unknown precision',
    ].filter(Boolean);
    return `Google place ${index + 1}: ${address} (${parts.join(', ')}) at ${pointText(result)}.`;
  });
  const extra = results.length - lines.length;
  if (extra > 0) lines.push(`Google returned ${extra} more places.`);
  return lines;
}

/**
 * A precise place whose name and house number are close to the address.
 * The town still has to match. A different house number is a miss.
 * An approximate town point is left for the town step.
 */
export function similarGooglePoint(
  body: unknown,
  wanted: { place: string; city?: string },
): SimilarGooglePoint | undefined {
  const asked = placeTokens(wanted.place, wanted.city);
  if (!asked.number && asked.words.length === 0) return undefined;
  for (const result of googleResults(body)) {
    if (!result.inSweden || result.lat == null || result.lng == null) continue;
    if (!result.precise && !(result.streetCenter && numberAgreed(result, asked.number))) continue;
    if (wanted.city && !result.townMatches(wanted.city)) continue;
    if (asked.number && result.number && result.number !== asked.number) continue;
    if (asked.number && !result.number && !hasNumber(result.formatted, asked.number)) continue;
    if (asked.words.length === 0 || !asked.words.every((word) => result.matchesWord(word)))
      continue;
    return {
      lat: result.lat,
      lng: result.lng,
      label: result.formatted || [result.route, result.number].filter(Boolean).join(' '),
    };
  }
  return undefined;
}

/** First result at the requested step: house number, street name, or town. */
export function pointFromGoogleGeocode(
  body: unknown,
  wanted: GoogleGeocodeWanted,
): GeocodePoint | undefined {
  if (!body || typeof body !== 'object' || !('results' in body)) return undefined;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return undefined;
  for (const result of results) {
    const point = readResult(result, wanted);
    if (point) return point;
  }
  return undefined;
}

export async function googleGeocodeBody(
  query: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', query.slice(0, 300));
  url.searchParams.set('region', 'se');
  url.searchParams.set('language', 'sv');
  url.searchParams.set('key', apiKey);
  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  return response.json();
}

export async function googleGeocodePoint(
  query: string,
  fetchImpl: typeof fetch,
  apiKey: string,
  wanted: GoogleGeocodeWanted,
): Promise<GeocodePoint | undefined> {
  return pointFromGoogleGeocode(await googleGeocodeBody(query, fetchImpl, apiKey), wanted);
}

interface AddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function readResult(result: unknown, wanted: GoogleGeocodeWanted): GeocodePoint | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as {
    formatted_address?: unknown;
    address_components?: unknown;
    types?: unknown;
    geometry?: { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown };
  };
  const components = Array.isArray(record.address_components)
    ? (record.address_components as AddressComponent[])
    : [];
  if (!inSweden(components)) return undefined;
  const lat = record.geometry?.location?.lat;
  const lng = record.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return undefined;
  if (wanted.cityOnly) {
    if (!townMatch(components, wanted.city)) return undefined;
    return { lat, lng };
  }
  if (wanted.premise) return premisePoint(record, components, lat, lng, wanted);
  if (wanted.street && !routeMatch(components, wanted.street)) return undefined;
  if (wanted.city && !townMatch(components, wanted.city)) return undefined;
  const number = houseNumber(components);
  if (wanted.streetOnly) {
    if (!wanted.street || number) return undefined;
    return { lat, lng };
  }
  if (wanted.onStreet) {
    if (!wanted.street) return undefined;
    const locationType = record.geometry?.location_type;
    if (
      locationType !== 'ROOFTOP' &&
      locationType !== 'RANGE_INTERPOLATED' &&
      locationType !== 'GEOMETRIC_CENTER'
    ) {
      return undefined;
    }
    return { lat, lng };
  }
  const locationType = record.geometry?.location_type;
  const precise = locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED';
  const numberedCenter =
    locationType === 'GEOMETRIC_CENTER' && Boolean(wanted.number) && number === wanted.number;
  if (!precise && !numberedCenter) return undefined;
  if (wanted.number && number !== wanted.number) return undefined;
  return { lat, lng };
}

function inSweden(components: AddressComponent[]): boolean {
  return components.some((component) => {
    if (!component.types?.includes('country')) return false;
    const short = component.short_name?.toUpperCase();
    const long = component.long_name?.toLocaleLowerCase('sv');
    return short === 'SE' || long === 'sweden' || long === 'sverige';
  });
}

function premisePoint(
  record: {
    formatted_address?: unknown;
    types?: unknown;
    geometry?: { location_type?: unknown };
  },
  components: AddressComponent[],
  lat: number,
  lng: number,
  wanted: GoogleGeocodeWanted,
): GeocodePoint | undefined {
  if (wanted.city && !townMatch(components, wanted.city)) return undefined;
  const locationType = record.geometry?.location_type;
  if (locationType !== 'ROOFTOP' && locationType !== 'RANGE_INTERPOLATED') return undefined;
  const types = Array.isArray(record.types) ? record.types : [];
  const place = types.some(
    (type) => type === 'premise' || type === 'street_address' || type === 'subpremise',
  );
  if (!place) return undefined;
  const formatted = typeof record.formatted_address === 'string' ? record.formatted_address : '';
  if (wanted.place && !containsPlace(formatted, wanted.place)) return undefined;
  const number = houseNumber(components);
  if (wanted.number && number && number !== wanted.number) return undefined;
  return { lat, lng };
}

function containsPlace(formatted: string, place: string): boolean {
  const text = fold(formatted);
  const wanted = fold(place);
  if (wanted.length > 0 && text.includes(wanted)) return true;
  const asked = placeTokens(place);
  if (asked.words.length === 0) return false;
  return asked.words.every((word) => text.split(' ').some((token) => namesSimilar(word, token)));
}

function routeMatch(components: AddressComponent[], street: string): boolean {
  return components.some((component) => {
    if (!component.types?.includes('route')) return false;
    return namesSimilar(component.long_name ?? '', street);
  });
}

function houseNumber(components: AddressComponent[]): string | undefined {
  const component = components.find((item) => item.types?.includes('street_number'));
  const number = component?.long_name?.replace(/\s+/g, '').toLocaleLowerCase('sv');
  return number || undefined;
}

function townMatch(components: AddressComponent[], city: string | undefined): boolean {
  if (!city) return true;
  const wanted = townKey(city);
  if (!wanted) return true;
  return components.some((component) => {
    const types = component.types ?? [];
    const town =
      types.includes('locality') ||
      types.includes('postal_town') ||
      types.includes('sublocality') ||
      types.includes('sublocality_level_1');
    return town && townKey(component.long_name) === wanted;
  });
}

interface GooglePlace {
  formatted: string;
  route?: string;
  number?: string;
  town?: string;
  locationType?: string;
  lat?: number;
  lng?: number;
  inSweden: boolean;
  precise: boolean;
  streetCenter: boolean;
  townMatches(city: string): boolean;
  matchesWord(word: string): boolean;
}

function googleResults(body: unknown): GooglePlace[] {
  if (!body || typeof body !== 'object' || !('results' in body)) return [];
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const places: GooglePlace[] = [];
  for (const result of results) {
    const place = readPlace(result);
    if (place) places.push(place);
  }
  return places;
}

function readPlace(result: unknown): GooglePlace | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as {
    formatted_address?: unknown;
    address_components?: unknown;
    geometry?: { location?: { lat?: unknown; lng?: unknown }; location_type?: unknown };
  };
  const components = Array.isArray(record.address_components)
    ? (record.address_components as AddressComponent[])
    : [];
  const lat = record.geometry?.location?.lat;
  const lng = record.geometry?.location?.lng;
  const point =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
      ? { lat, lng }
      : {};
  const locationType =
    typeof record.geometry?.location_type === 'string' ? record.geometry.location_type : undefined;
  const route = components.find((component) => component.types?.includes('route'))?.long_name;
  const formatted = typeof record.formatted_address === 'string' ? record.formatted_address : '';
  const town = components.find((component) => {
    const types = component.types ?? [];
    return (
      types.includes('locality') || types.includes('postal_town') || types.includes('sublocality')
    );
  })?.long_name;
  return {
    formatted,
    ...(route ? { route } : {}),
    ...(houseNumber(components) ? { number: houseNumber(components) } : {}),
    ...(town ? { town } : {}),
    ...(locationType ? { locationType } : {}),
    ...point,
    inSweden: inSweden(components),
    precise: locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED',
    streetCenter: locationType === 'GEOMETRIC_CENTER',
    townMatches(city) {
      return townMatch(components, city);
    },
    matchesWord(word) {
      const tokens = `${formatted} ${route ?? ''}`.split(/[^0-9A-Za-zÅÄÖåäö]+/);
      return tokens.some((token) => namesSimilar(word, token));
    },
  };
}

const DIRECTIONS = new Set([
  'norra',
  'sodra',
  'ostra',
  'vastra',
  'ovre',
  'nedre',
  'stora',
  'lilla',
]);

function placeTokens(place: string, city?: string): { words: string[]; number?: string } {
  const cityKey = townKey(city);
  const number = fold(place).match(/\d{1,4}[a-z]?/)?.[0];
  const words = fold(place)
    .split(' ')
    .filter(
      (word) => word.length >= 4 && word !== cityKey && !DIRECTIONS.has(word) && !/^\d/.test(word),
    );
  return { words, ...(number ? { number } : {}) };
}

function hasNumber(formatted: string, number: string): boolean {
  return fold(formatted).split(' ').includes(number);
}

function numberAgreed(result: GooglePlace, number: string | undefined): boolean {
  if (!number) return false;
  if (result.number === number) return true;
  return !result.number && hasNumber(result.formatted, number);
}

function namesSimilar(left: string, right: string): boolean {
  if (sharesRoadName(left, right)) return true;
  const a = streetBase(left);
  const b = streetBase(right);
  if (a.kind && b.kind && a.kind !== b.kind) return false;
  if (!a.base && !b.base) return a.kind !== '' && a.kind === b.kind;
  if (!a.base || !b.base) return false;
  if (a.base === b.base) return true;
  const length = Math.min(a.base.length, b.base.length);
  if (length < 5) return false;
  const limit = length >= 8 ? 2 : 1;
  return levenshtein(a.base, b.base) <= limit;
}

/** `Sibov` and `Sibovägen` are the same road. The suffix can share its first letter. */
function sharesRoadName(left: string, right: string): boolean {
  const a = fold(left).replace(/ /g, '');
  const b = fold(right).replace(/ /g, '');
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 5 || !longer.startsWith(shorter)) return false;
  const rest = longer.slice(shorter.length);
  if (!rest) return true;
  const suffixes = [
    'vagen',
    'vag',
    'gatan',
    'gata',
    'granden',
    'grand',
    'torget',
    'torg',
    'allen',
    'alle',
    'stigen',
    'stig',
    'esplanaden',
    'kajen',
  ];
  return suffixes.some((suffix) => {
    if (rest === suffix) return true;
    const overlap = suffix.slice(0, suffix.length - rest.length);
    return overlap.length > 0 && suffix.endsWith(rest) && shorter.endsWith(overlap);
  });
}

function streetBase(value: string): { base: string; kind: string } {
  const words = fold(value)
    .split(' ')
    .filter((word) => word && !DIRECTIONS.has(word));
  const text = words.join('');
  const suffixes: { pattern: RegExp; kind: string }[] = [
    { pattern: /gatan$|gata$/, kind: 'gata' },
    { pattern: /vagen$|vag$/, kind: 'vag' },
    { pattern: /granden$|grand$/, kind: 'grand' },
    { pattern: /torget$|torg$/, kind: 'torg' },
    { pattern: /allen$|alle$/, kind: 'alle' },
    { pattern: /stigen$|stig$/, kind: 'stig' },
    { pattern: /esplanaden$/, kind: 'esplanad' },
    { pattern: /kajen$/, kind: 'kaj' },
  ];
  for (const suffix of suffixes) {
    if (!suffix.pattern.test(text)) continue;
    let base = text.replace(suffix.pattern, '');
    if (base.endsWith('s') && base.length > 4) base = base.slice(0, -1);
    return { base, kind: suffix.kind };
  }
  return { base: text, kind: '' };
}

function townKey(value: string | undefined): string {
  let name = fold(value ?? '');
  if (name.endsWith(' kommun')) {
    name = name.slice(0, -' kommun'.length);
    if (name.endsWith('s') && name.length > 4) name = name.slice(0, -1);
  }
  return name;
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase('sv')
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[.’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) rows[0]![column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row]![column] = Math.min(
        rows[row - 1]![column]! + 1,
        rows[row]![column - 1]! + 1,
        rows[row - 1]![column - 1]! + cost,
      );
    }
  }
  return rows[left.length]![right.length]!;
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function pointText(point: { lat?: number; lng?: number }): string {
  if (point.lat == null || point.lng == null) return 'no point';
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

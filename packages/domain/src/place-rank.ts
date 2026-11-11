import { cityInPlaceText, sourcePlace, type SourcePlace } from './import-city';
import { addressRankReplaces, venueNamesMatch } from './import-scan';
import { venueIdentity } from './venue';

/**
 * Strongest point wins, and a later lookup does not replace it with a weaker one.
 * `scraped` is an API or page coordinate. `scan` is a point the description printed.
 * `source` belongs to the source's own building. `address` is a street geocode.
 * `places` is a Google Places hit for the venue name and city. `city` is the town.
 */
export const POINT_RANKS = ['scraped', 'scan', 'source', 'address', 'places', 'city'] as const;
export type PointRank = (typeof POINT_RANKS)[number];

const RANK_SCORE: Record<PointRank, number> = {
  scraped: 60,
  scan: 50,
  source: 40,
  address: 30,
  places: 20,
  city: 10,
};

export function pointRankBeats(next: PointRank, current: PointRank | null | undefined): boolean {
  if (!current) return true;
  return RANK_SCORE[next] > RANK_SCORE[current];
}

export interface PlacePoint {
  lat: number;
  lng: number;
}

export interface PlaceBits {
  city?: string;
  venueName?: string;
  street?: string;
  zipCode?: string;
  point?: PlacePoint;
  /** Set on the scan address. Over 80 replaces the scraped street, city, and point. */
  rank?: number;
}

export type PlaceLookup = 'done' | 'street' | 'venue' | 'city';

export type PlaceFill = 'stored' | 'street' | 'venue' | 'places' | 'city';

export interface ChosenPlace extends PlaceBits {
  pointRank?: PointRank;
  lookup: PlaceLookup;
  /** Which step produced `point`. Absent when the showing still has none. */
  filledBy?: PlaceFill;
}

function clean(value: string | null | undefined, max = 200): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return undefined;
  return text;
}

/** A venue name that is only the town is not a venue. */
function venueLabel(name: string | null | undefined, city: string | undefined): string | undefined {
  const label = clean(name, 500);
  if (!label || !venueIdentity(label, city ?? 'x')) return undefined;
  if (city && venueNamesMatch(label, city)) return undefined;
  return label;
}

/**
 * One showing's place before any geocoder runs.
 * A scraped value wins. A scan address ranked over 80 replaces that street, city, and point.
 * Otherwise the scan fills a blank and replaces a source default.
 * The source point stays only while the venue is still that source's building.
 * A digital showing does not inherit the source town or a map point.
 */
export function chooseOccasionPlace(input: {
  digital: boolean;
  source: SourcePlace;
  scraped: PlaceBits;
  scan: PlaceBits;
}): ChosenPlace {
  const source = input.digital ? {} : input.source;
  const scanWins = !input.digital && addressRankReplaces(input.scan.rank);
  const city = scanWins
    ? (clean(input.scan.city, 80) ??
      cityInPlaceText([input.scan.street, input.scan.venueName].filter(Boolean).join(' ')))
    : (clean(input.scraped.city, 80) ??
      cityInPlaceText([input.scraped.street, input.scraped.venueName].filter(Boolean).join(' ')) ??
      clean(input.scan.city, 80) ??
      cityInPlaceText([input.scan.street, input.scan.venueName].filter(Boolean).join(' ')) ??
      clean(source.city, 80));

  const scrapedVenue = venueLabel(input.scraped.venueName, city);
  const scanVenue = venueLabel(input.scan.venueName, city);
  const sourceVenue = venueLabel(source.venueName, city);
  const venueName = scrapedVenue ?? scanVenue ?? sourceVenue;
  const sameBuilding =
    Boolean(sourceVenue) && Boolean(venueName) && venueNamesMatch(venueName, sourceVenue);
  const keepSourceStreet = sameBuilding || (!scrapedVenue && !scanVenue);

  const street = scanWins
    ? clean(input.scan.street)
    : (clean(input.scraped.street) ??
      clean(input.scan.street) ??
      (keepSourceStreet ? clean(source.street) : undefined));
  const zipCode = scanWins
    ? clean(input.scan.zipCode, 5)
    : (clean(input.scraped.zipCode, 5) ?? clean(input.scan.zipCode, 5));

  let point = scanWins ? undefined : input.scraped.point;
  let pointRank: PointRank | undefined = point ? 'scraped' : undefined;
  if (!point && input.scan.point) {
    point = input.scan.point;
    pointRank = 'scan';
  }
  if (!scanWins && !point && source.point && (sameBuilding || (!scrapedVenue && !scanVenue))) {
    point = source.point;
    pointRank = 'source';
  }

  let lookup: PlaceLookup = 'done';
  if (!point && !input.digital) {
    if (street || (zipCode && city)) lookup = 'street';
    else if (venueName && city) lookup = 'venue';
    else if (city) lookup = 'city';
  }

  return {
    ...(city ? { city } : {}),
    ...(venueName ? { venueName } : {}),
    ...(street ? { street } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(point ? { point, pointRank } : {}),
    lookup,
  };
}

export interface PlaceLookups {
  geocodeStreet(
    street: string | undefined,
    zipCode: string | undefined,
    city: string | undefined,
  ): Promise<PlacePoint | undefined>;
  findVenue(
    name: string,
    city: string,
  ): Promise<{ point: PlacePoint; rank: PointRank } | undefined>;
  findPlaces(name: string, city: string): Promise<PlacePoint | undefined>;
  cityPoint(city: string): Promise<PlacePoint | undefined>;
}

/**
 * Fills a missing point. A street is geocoded first. A miss looks up the venue
 * by name and city, then Google Places, then the town. A stored venue point
 * that is only the town still asks Places, because that rank is stronger.
 */
export async function fillPlacePoint(
  chosen: ChosenPlace,
  lookups: PlaceLookups,
): Promise<ChosenPlace> {
  if (chosen.point || chosen.lookup === 'done') {
    return chosen.point ? { ...chosen, filledBy: 'stored' } : chosen;
  }

  if (chosen.lookup === 'street') {
    const point = await lookups.geocodeStreet(chosen.street, chosen.zipCode, chosen.city);
    if (point) {
      return { ...chosen, point, pointRank: 'address', lookup: 'done', filledBy: 'street' };
    }
  }

  if (chosen.venueName && chosen.city) {
    const stored = await lookups.findVenue(chosen.venueName, chosen.city);
    if (stored && !pointRankBeats('places', stored.rank)) {
      return {
        ...chosen,
        point: stored.point,
        pointRank: stored.rank,
        lookup: 'done',
        filledBy: 'venue',
      };
    }
    const places = await lookups.findPlaces(chosen.venueName, chosen.city);
    if (places) {
      return { ...chosen, point: places, pointRank: 'places', lookup: 'done', filledBy: 'places' };
    }
    if (stored) {
      return {
        ...chosen,
        point: stored.point,
        pointRank: stored.rank,
        lookup: 'done',
        filledBy: 'venue',
      };
    }
  }

  if (chosen.city) {
    const point = await lookups.cityPoint(chosen.city);
    if (point) return { ...chosen, point, pointRank: 'city', lookup: 'done', filledBy: 'city' };
  }
  return { ...chosen, lookup: 'done' };
}

/**
 * Scraped fields for one stored showing. A city that is only the source default
 * stays on the source, so a confident scan town can replace it. A venue equal
 * to that default stays on the source for the same reason.
 */
export function buildOccasionPlace(input: {
  digital: boolean;
  workerId?: string | null;
  occasionVenueName?: string | null;
  address?: {
    address?: string | null;
    zipCode?: string | null;
    city?: string | null;
    location?: PlacePoint | null;
  } | null;
  scan: PlaceBits;
}): ChosenPlace {
  const source = sourcePlace(input.workerId);
  const street = clean(input.address?.address);
  const occasionVenue = clean(input.occasionVenueName, 500);
  const rawCity = clean(input.address?.city, 80);
  const townInText = cityInPlaceText([street, occasionVenue].filter(Boolean).join(' '));
  const cityIsDefault =
    Boolean(rawCity) &&
    Boolean(source.city) &&
    venueNamesMatch(rawCity, source.city) &&
    !townInText;
  const venueIsDefault =
    Boolean(occasionVenue) &&
    Boolean(source.venueName) &&
    venueNamesMatch(occasionVenue, source.venueName);
  const sharedPoint = !occasionVenue || venueIsDefault;

  return chooseOccasionPlace({
    digital: input.digital,
    source,
    scraped: {
      ...(street ? { street } : {}),
      ...(clean(input.address?.zipCode, 5) ? { zipCode: clean(input.address?.zipCode, 5) } : {}),
      ...(!cityIsDefault && rawCity ? { city: rawCity } : {}),
      ...(!venueIsDefault && occasionVenue ? { venueName: occasionVenue } : {}),
      ...(sharedPoint && input.address?.location ? { point: input.address.location } : {}),
    },
    scan: input.scan,
  });
}

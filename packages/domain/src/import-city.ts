/** Place a source knows before the page is read. A point belongs to that venue. */
export interface SourcePlace {
  city?: string;
  venueName?: string;
  street?: string;
  point?: { lat: number; lng: number };
}

/**
 * Defaults for a source that covers one town, or one building.
 * A source that covers many towns has no entry. Ovanåker's town is Edsbyn,
 * and only after the page text has been checked for another town.
 * Systrarna's building is not named here; the page has to supply it.
 */
export const SOURCE_PLACE: Readonly<Record<string, SourcePlace>> = {
  'visit-soderhamn': { city: 'Söderhamn' },
  'soderhamn-biblioteket': {
    city: 'Söderhamn',
    venueName: 'Söderhamns stadsbibliotek',
    street: 'Köpmangatan 11',
    point: { lat: 61.3023668, lng: 17.0549701 },
  },
  systrarna: { city: 'Söderhamn' },
  'halsinglands-museum': { city: 'Hudiksvall' },
  'glada-hudik': { city: 'Hudiksvall' },
  'bollnas-kommun': { city: 'Bollnäs' },
  ovanaker: { city: 'Edsbyn' },
};

/** City a source knows when the page names none. */
export const SOURCE_CITY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCE_PLACE).flatMap(([slug, place]) =>
    place.city ? [[slug, place.city] as const] : [],
  ),
);

const PLACE_TOWNS = [
  'Söderhamn',
  'Bollnäs',
  'Hudiksvall',
  'Ljusdal',
  'Gävle',
  'Delsbo',
  'Iggesund',
  'Bjuråker',
  'Friggesund',
  'Näsviken',
  'Järvsö',
  'Färila',
  'Edsbyn',
  'Alfta',
  'Kilafors',
  'Arbrå',
  'Rengsjö',
  'Vallsta',
  'Ljusne',
  'Sandarne',
  'Stråtjära',
  'Bergsjö',
  'Gnarp',
  'Hassela',
  'Enånger',
  'Holmsveden',
  'Marmaverken',
  'Runemo',
  'Segersta',
  'Undersvik',
  'Freluga',
  'Sibo',
  'Hällbo',
  'Växbo',
  'Glösbo',
  'Hanebo',
  'Lottefors',
  'Röste',
  'Simeå',
  'Söräng',
  'Mohed',
  'Trönö',
  'Los',
  'Hamra',
  'Kårböle',
  'Ramsjö',
  'Tallåsen',
  'Voxnabruk',
  'Njutånger',
  'Forsa',
  'Ilsbo',
  'Bergvik',
  'Norrala',
  'Söderala',
] as const;

const TOWN_BY_KEY = new Map(PLACE_TOWNS.map((town) => [town.toLocaleLowerCase('sv'), town]));

function clean(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return undefined;
  return text;
}

/** City the source uses when an event page does not name one. */
export function sourceCity(slug: string | null | undefined): string | undefined {
  if (!slug) return undefined;
  return SOURCE_CITY[slug];
}

/** Venue, street, and point the source knows before the page is read. */
export function sourcePlace(slug: string | null | undefined): SourcePlace {
  if (!slug) return {};
  return SOURCE_PLACE[slug] ?? {};
}

/**
 * Last known town in a place line, such as `Kyrkogatan 14 Ljusdal`.
 * A word shorter than four letters is left out.
 */
export function cityInPlaceText(text: string | null | undefined): string | undefined {
  const tokens = text?.toLocaleLowerCase('sv').match(/\p{L}+/gu) ?? [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index] ?? '';
    const town =
      TOWN_BY_KEY.get(token) ??
      (token.endsWith('s') ? TOWN_BY_KEY.get(token.slice(0, -1)) : undefined);
    if (town) return town;
  }
  return undefined;
}

/**
 * Scraped city, then a town written in the place line, then the source city.
 * An unknown source with no town in the text stays empty.
 */
export function resolveImportCity(input: {
  city?: string | null;
  placeText?: string | null;
  fallback?: string | null;
}): string | undefined {
  return clean(input.city) ?? cityInPlaceText(input.placeText) ?? clean(input.fallback);
}

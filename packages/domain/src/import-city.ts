/**
 * City a source knows when the page names none. A source that covers many
 * towns has no entry, and the city stays empty.
 */
export const SOURCE_CITY: Readonly<Record<string, string>> = {
  'visit-soderhamn': 'Söderhamn',
  'soderhamn-biblioteket': 'Söderhamn',
  systrarna: 'Söderhamn',
  'halsinglands-museum': 'Hudiksvall',
  'glada-hudik': 'Hudiksvall',
  'bollnas-kommun': 'Bollnäs',
};

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

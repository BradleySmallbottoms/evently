/** How far a coordinate may look for a city name. */
export const NEARBY_CITY_RADIUS_KM = 25;

const COUNTRIES = new Set(['sweden', 'sverige', 'se']);

/** Suffix on a word, so `Storgatan` counts and `Söderhamn` does not. */
const STREET_SUFFIX =
  /(gatan|gata|vägen|väg|gränden|gränd|torget|torg|allén|allé|stigen|stig|kajen|esplanaden|street|road|avenue|lane)$/i;

export interface ReversePlace {
  city?: string;
  /** Settlement on a house or street hit when `city` is empty. */
  locality?: string;
  name?: string;
  /** Photon `type`, such as `city`, `locality`, or `street`. */
  kind?: string;
  countryCode?: string;
}

/**
 * City from a scraped address. A postal line (`826 30 Söderhamn`) wins.
 * Otherwise the last place-like part is used. A street with no city is left out.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const text = address?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !COUNTRIES.has(part.toLocaleLowerCase('sv')));
  if (parts.length === 0) return null;

  let postalCity: string | null = null;
  for (const part of parts) {
    const match = /^(?:\d{3}\s?\d{2})\s+(.+)$/.exec(part);
    const city = usableCity(match?.[1]);
    if (city) postalCity = city;
  }
  if (postalCity) return postalCity;

  return usableCity(parts.at(-1));
}

/**
 * Nearest city from a reverse-geocoder result, closest feature first.
 * A street hit's city is used. A hit outside Sweden is skipped.
 */
export function nearestCityName(features: ReversePlace[]): string | null {
  for (const feature of features) {
    const country = feature.countryCode?.trim().toUpperCase();
    if (country && country !== 'SE') continue;
    const city = usableCity(feature.city) ?? usableCity(feature.locality);
    if (city) return city;
    if (feature.kind === 'city' || feature.kind === 'locality') {
      const name = usableCity(feature.name);
      if (name) return name;
    }
  }
  return null;
}

function usableCity(value: string | null | undefined): string | null {
  const name = value?.replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (/\d/.test(name)) return null;
  const lower = name.toLocaleLowerCase('sv');
  if (COUNTRIES.has(lower) || lower.endsWith(' län')) return null;
  if (name.split(/\s+/).some((word) => STREET_SUFFIX.test(word))) return null;
  if (name.split(/\s+/).length > 4) return null;
  return name;
}

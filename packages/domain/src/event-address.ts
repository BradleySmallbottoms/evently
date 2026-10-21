/** Street, postcode, and city collected by an importer or from an event page. */
export interface EventAddressParts {
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  location?: { lat: number; lng: number } | null;
}

export interface EventAddressRecord {
  address?: string;
  zipCode?: string;
  city?: string;
  country?: 'Sweden';
  location?: { lat: number; lng: number };
}

const POSTCODE = /^(\d{3})\s?(\d{2})(?:\s|$)/;

/** Five digits, with or without the space in `826 32`. A following city is ignored. Six digits are dropped. */
export function zipCodeOf(value: string | null | undefined): string | undefined {
  const match = POSTCODE.exec(value?.replace(/\s+/g, ' ').trim() ?? '');
  return match ? `${match[1]}${match[2]}` : undefined;
}

function textOf(value: string | null | undefined, limit: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text || text.length > limit) return undefined;
  return text;
}

function pointOf(
  value: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } | undefined {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return undefined;
  if (value.lat < -90 || value.lat > 90 || value.lng < -180 || value.lng > 180) return undefined;
  return { lat: value.lat, lng: value.lng };
}

/** Omits empty parts. Sets `country` when anything else is present. */
export function eventAddress(input: EventAddressParts): EventAddressRecord | undefined {
  const address = textOf(input.address, 200);
  const zipCode = zipCodeOf(input.zipCode);
  const city = textOf(input.city, 80);
  const location = pointOf(input.location);
  if (!address && !zipCode && !city && !location) return undefined;
  return {
    ...(address ? { address } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(city ? { city } : {}),
    country: 'Sweden',
    ...(location ? { location } : {}),
  };
}

/**
 * An import with no address keeps the stored one. A new address keeps a point
 * the scan already wrote when the import has none.
 */
export function mergeEventAddress(
  incoming: EventAddressRecord | undefined,
  stored: EventAddressRecord | undefined,
): EventAddressRecord | undefined {
  if (!incoming) return stored;
  if (!stored?.location || incoming.location) return incoming;
  return { ...incoming, location: stored.location };
}

/** A street, or a postcode together with a city. A city alone is not a precise query. */
export function canGeocodeAddress(input: EventAddressParts): boolean {
  return Boolean(
    textOf(input.address, 200) || (zipCodeOf(input.zipCode) && textOf(input.city, 80)),
  );
}

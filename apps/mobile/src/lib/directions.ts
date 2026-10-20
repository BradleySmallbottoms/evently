import { canGeocodeAddress, zipCodeOf, type EventAddressParts } from '@local-events/domain';

/** Street, or postcode and city, as a maps search. A city alone is left out. */
export function directionsPlace(address?: EventAddressParts | null): string | undefined {
  if (!address || !canGeocodeAddress(address)) return undefined;
  const street = address.address?.replace(/\s+/g, ' ').trim();
  const zip = zipCodeOf(address.zipCode);
  const city = address.city?.replace(/\s+/g, ' ').trim();
  const postal = [zip ? `${zip.slice(0, 3)} ${zip.slice(3)}` : undefined, city]
    .filter(Boolean)
    .join(' ');
  return [street, postal, 'Sweden'].filter(Boolean).join(', ');
}

/** Turn-by-turn URL for the device maps app. A stored address is the destination; coordinates are the fallback. */
export function directionsUrl(
  lat: number,
  lng: number,
  platform: string,
  address?: EventAddressParts | null,
): string {
  const place = directionsPlace(address);
  const destination = place ?? `${lat},${lng}`;
  if (platform === 'ios') {
    const daddr = place ? encodeURIComponent(place) : destination;
    return `https://maps.apple.com/?daddr=${daddr}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

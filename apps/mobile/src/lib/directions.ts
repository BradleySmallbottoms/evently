/** Turn-by-turn URL for the device maps app. Coordinates only — never a guessed address. */
export function directionsUrl(lat: number, lng: number, platform: string): string {
  const point = `${lat},${lng}`;
  if (platform === 'ios') {
    return `https://maps.apple.com/?daddr=${point}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(point)}`;
}

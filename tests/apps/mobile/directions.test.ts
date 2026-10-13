import { describe, expect, it } from 'vitest';

import { directionsUrl } from '../../../apps/mobile/src/lib/directions';

describe('directionsUrl', () => {
  it('opens Apple Maps driving directions on iOS', () => {
    expect(directionsUrl(61.303, 17.059, 'ios')).toBe(
      'https://maps.apple.com/?daddr=61.303,17.059&dirflg=d',
    );
  });

  it('opens Google Maps directions on Android and web', () => {
    const expected = 'https://www.google.com/maps/dir/?api=1&destination=61.303%2C17.059';
    expect(directionsUrl(61.303, 17.059, 'android')).toBe(expected);
    expect(directionsUrl(61.303, 17.059, 'web')).toBe(expected);
  });
});

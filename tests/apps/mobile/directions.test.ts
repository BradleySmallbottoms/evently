import { describe, expect, it } from 'vitest';

import { directionsPlace, directionsUrl } from '../../../apps/mobile/src/lib/directions';

const place = {
  address: 'Köpmangatan 14',
  zipCode: '82471',
  city: 'Delsbo',
  country: 'Sweden' as const,
};

describe('directionsPlace', () => {
  it('formats a street, spaced postcode, and city', () => {
    expect(directionsPlace(place)).toBe('Köpmangatan 14, 824 71 Delsbo, Sweden');
  });

  it('uses a postcode and city when the street is missing', () => {
    expect(directionsPlace({ zipCode: '82471', city: 'Delsbo' })).toBe('824 71 Delsbo, Sweden');
  });

  it('leaves out a city on its own', () => {
    expect(directionsPlace({ city: 'Hudiksvall' })).toBeUndefined();
    expect(directionsPlace(undefined)).toBeUndefined();
  });
});

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

  it('uses the stored address as the destination', () => {
    const query = encodeURIComponent('Köpmangatan 14, 824 71 Delsbo, Sweden');
    expect(directionsUrl(61.303, 17.059, 'ios', place)).toBe(
      `https://maps.apple.com/?daddr=${query}&dirflg=d`,
    );
    expect(directionsUrl(61.303, 17.059, 'android', place)).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${query}`,
    );
  });

  it('keeps coordinates when the address is only a city', () => {
    expect(directionsUrl(61.303, 17.059, 'ios', { city: 'Hudiksvall' })).toBe(
      'https://maps.apple.com/?daddr=61.303,17.059&dirflg=d',
    );
  });
});

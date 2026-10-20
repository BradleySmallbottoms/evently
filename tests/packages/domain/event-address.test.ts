import { describe, expect, it } from 'vitest';
import {
  canGeocodeAddress,
  eventAddress,
  mergeEventAddress,
  zipCodeOf,
} from '../../../packages/domain/src/event-address';

describe('eventAddress', () => {
  it('keeps a street, a five-digit postcode, and a point', () => {
    expect(
      eventAddress({
        address: ' Köpmangatan 14 ',
        zipCode: '824 71',
        city: 'Delsbo',
        location: { lat: 61.8, lng: 16.55 },
      }),
    ).toEqual({
      address: 'Köpmangatan 14',
      zipCode: '82471',
      city: 'Delsbo',
      country: 'Sweden',
      location: { lat: 61.8, lng: 16.55 },
    });
  });

  it('drops a postcode that is not five digits and a city on its own cannot be geocoded', () => {
    expect(zipCodeOf('123456')).toBeUndefined();
    expect(zipCodeOf('82471 Delsbo')).toBe('82471');
    expect(zipCodeOf('824 71 Iggesund')).toBe('82471');
    expect(eventAddress({ city: 'Hudiksvall' })).toEqual({ city: 'Hudiksvall', country: 'Sweden' });
    expect(canGeocodeAddress({ city: 'Hudiksvall' })).toBe(false);
    expect(canGeocodeAddress({ address: 'Köpmangatan 14' })).toBe(true);
    expect(canGeocodeAddress({ zipCode: '824 71', city: 'Delsbo' })).toBe(true);
  });

  it('keeps a stored point when a later import has the same address without one', () => {
    const stored = eventAddress({
      address: 'Köpmangatan 14',
      city: 'Delsbo',
      location: { lat: 61.8, lng: 16.55 },
    });
    const incoming = eventAddress({ address: 'Köpmangatan 14', city: 'Delsbo' });
    expect(mergeEventAddress(incoming, stored)?.location).toEqual({ lat: 61.8, lng: 16.55 });
    expect(mergeEventAddress(undefined, stored)).toEqual(stored);
    expect(mergeEventAddress(incoming, undefined)).toEqual(incoming);
  });
});

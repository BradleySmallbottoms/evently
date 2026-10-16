import { cityFromAddress, nearestCityName } from '../../../packages/domain/src/venue-city';
import { describe, expect, it } from 'vitest';

describe('cityFromAddress', () => {
  it('reads the city after a Swedish postal code', () => {
    expect(cityFromAddress('Storgatan 1, 826 30 Söderhamn, Sweden')).toBe('Söderhamn');
    expect(cityFromAddress('Bjuråkers bibliotek, 824 95 Bjuråker')).toBe('Bjuråker');
  });

  it('uses a bare place name', () => {
    expect(cityFromAddress('Bollnäs')).toBe('Bollnäs');
    expect(cityFromAddress('Hudiksvall, Sverige')).toBe('Hudiksvall');
  });

  it('leaves a street with no city', () => {
    expect(cityFromAddress('Storgatan 1')).toBeNull();
    expect(cityFromAddress('Storgatan, Sweden')).toBeNull();
    expect(cityFromAddress('Skogsvägen')).toBeNull();
    expect(cityFromAddress('Sweden')).toBeNull();
    expect(cityFromAddress('')).toBeNull();
  });
});

describe('nearestCityName', () => {
  it('uses the city on the closest hit', () => {
    expect(
      nearestCityName([
        { city: 'Söderhamn', name: 'Storgatan', kind: 'street', countryCode: 'SE' },
        { name: 'Hudiksvall', kind: 'city', countryCode: 'SE' },
      ]),
    ).toBe('Söderhamn');
  });

  it('uses the locality when a street hit has no city field', () => {
    expect(
      nearestCityName([
        { name: 'Byvägen', locality: 'Bjuråker', kind: 'street', countryCode: 'SE' },
      ]),
    ).toBe('Bjuråker');
  });

  it('uses a city or locality name when the hit has no city field', () => {
    expect(nearestCityName([{ name: 'Delsbo', kind: 'locality', countryCode: 'se' }])).toBe(
      'Delsbo',
    );
  });

  it('skips a hit outside Sweden and a street with no city', () => {
    expect(
      nearestCityName([
        { city: 'Berlin', kind: 'city', countryCode: 'DE' },
        { name: 'Storgatan', kind: 'street', countryCode: 'SE' },
      ]),
    ).toBeNull();
  });
});

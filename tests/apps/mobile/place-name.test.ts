import { describe, expect, it } from 'vitest';

import { matchingPlace, placeLabelFromGeocode } from '../../../apps/mobile/src/lib/place-name';
import { queryPointForArea } from '../../../apps/mobile/src/lib/area-point';

describe('placeLabelFromGeocode', () => {
  it('prefers the city, then a district, then wider names', () => {
    expect(
      placeLabelFromGeocode({
        city: 'Söderhamn',
        district: 'Centrum',
        subregion: 'Söderhamns kommun',
        region: 'Gävleborg',
        name: 'Köpmangatan',
      }),
    ).toBe('Söderhamn');
    expect(placeLabelFromGeocode({ city: '  ', district: 'Bergvik' })).toBe('Bergvik');
    expect(placeLabelFromGeocode({ region: 'Gävleborgs län' })).toBe('Gävleborgs län');
  });

  it('returns null when the geocoder has no usable name', () => {
    expect(placeLabelFromGeocode(null)).toBeNull();
    expect(placeLabelFromGeocode({ city: '  ', name: '' })).toBeNull();
  });
});

describe('matchingPlace', () => {
  const places = [
    { name: 'Bollnäs' },
    { name: 'Söderhamn' },
  ];

  it('matches only the whole suggestion name', () => {
    expect(matchingPlace('Boll', places)).toBeNull();
    expect(matchingPlace('bollnäs', places)?.name).toBe('Bollnäs');
  });
});

describe('queryPointForArea', () => {
  it('uses a circle center and radius', () => {
    expect(
      queryPointForArea({
        active: true,
        center: { lat: 61.3, lng: 17.06 },
        radiusM: 8_000,
        polygon: null,
      }),
    ).toEqual({ lat: 61.3, lng: 17.06, radiusM: 8_000 });
  });

  it('uses the polygon centroid and covers the bounding box', () => {
    const point = queryPointForArea({
      active: true,
      center: null,
      radiusM: null,
      polygon: [
        { lat: 61.0, lng: 16.8 },
        { lat: 61.5, lng: 16.8 },
        { lat: 61.5, lng: 17.4 },
        { lat: 61.0, lng: 17.4 },
      ],
    });
    expect(point?.lat).toBeCloseTo(61.25);
    expect(point?.lng).toBeCloseTo(17.1);
    expect(point?.radiusM).toBeGreaterThan(15_000);
  });

  it('skips inactive areas', () => {
    expect(
      queryPointForArea({
        active: false,
        center: { lat: 61.3, lng: 17.06 },
        radiusM: 8_000,
      }),
    ).toBeNull();
  });
});

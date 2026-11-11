import { describe, expect, it } from 'vitest';
import {
  buildOccasionPlace,
  fillPlacePoint,
  pointRankBeats,
  type PlaceLookups,
} from '../../../packages/domain/src/place-rank';

const point = { lat: 61.3, lng: 17.06 };

function lookups(partial: Partial<PlaceLookups> = {}): PlaceLookups {
  return {
    geocodeStreet: async () => undefined,
    findVenue: async () => undefined,
    findPlaces: async () => undefined,
    cityPoint: async () => undefined,
    ...partial,
  };
}

describe('chooseOccasionPlace', () => {
  it('keeps the library point while the showing is still that building', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'soderhamn-biblioteket',
      occasionVenueName: 'Söderhamns stadsbibliotek',
      address: { city: 'Söderhamn' },
      scan: {},
    });
    expect(chosen.pointRank).toBe('source');
    expect(chosen.point).toEqual({ lat: 61.3023668, lng: 17.0549701 });
    expect(chosen.lookup).toBe('done');
  });

  it('drops the library point when the showing names another venue', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'soderhamn-biblioteket',
      occasionVenueName: 'Kulturhuset',
      address: { city: 'Söderhamn', location: point },
      scan: { venueName: 'Kulturhuset' },
    });
    expect(chosen.venueName).toBe('Kulturhuset');
    expect(chosen.point).toBeUndefined();
    expect(chosen.lookup).toBe('venue');
  });

  it('lets a scan town replace the source town', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'ovanaker',
      address: { city: 'Edsbyn' },
      scan: { city: 'Alfta', venueName: 'Alfta Kyrka' },
    });
    expect(chosen.city).toBe('Alfta');
    expect(chosen.venueName).toBe('Alfta Kyrka');
    expect(chosen.lookup).toBe('venue');
  });

  it('reads a town written in the street before the source town', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'bollnas-kommun',
      address: { address: 'Kyrkogatan 14 Ljusdal' },
      scan: {},
    });
    expect(chosen.city).toBe('Ljusdal');
    expect(chosen.lookup).toBe('street');
  });

  it('does not give a digital showing the source town', () => {
    const chosen = buildOccasionPlace({
      digital: true,
      workerId: 'glada-hudik',
      occasionVenueName: 'digitalt',
      address: { city: 'Hudiksvall' },
      scan: {},
    });
    expect(chosen.city).toBeUndefined();
    expect(chosen.point).toBeUndefined();
    expect(chosen.lookup).toBe('done');
  });

  it('replaces a scraped street and point when the scan address ranks over 80', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'abf-halsingland',
      address: {
        address: 'Kalavägen 10',
        city: 'Järvsö',
        location: { lat: 61.7158943, lng: 16.1693209 },
      },
      scan: { street: 'Storgatan 9', city: 'Färila', rank: 90 },
    });
    expect(chosen.street).toBe('Storgatan 9');
    expect(chosen.city).toBe('Färila');
    expect(chosen.point).toBeUndefined();
    expect(chosen.lookup).toBe('street');
  });

  it('keeps the scraped street when the scan address rank is 80', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'abf-halsingland',
      address: { address: 'Kalavägen 10', city: 'Järvsö', location: point },
      scan: { street: 'Storgatan 9', city: 'Färila', rank: 80 },
    });
    expect(chosen.street).toBe('Kalavägen 10');
    expect(chosen.city).toBe('Järvsö');
    expect(chosen.point).toEqual(point);
    expect(chosen.lookup).toBe('done');
  });

  it('treats a city-only name as the town, not a venue', () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'visit-soderhamn',
      occasionVenueName: 'Bjuråker',
      address: { city: 'Bjuråker' },
      scan: {},
    });
    expect(chosen.venueName).toBeUndefined();
    expect(chosen.city).toBe('Bjuråker');
    expect(chosen.lookup).toBe('city');
  });
});

describe('fillPlacePoint', () => {
  it('keeps a street geocode ahead of a venue row', async () => {
    const chosen = buildOccasionPlace({
      digital: false,
      workerId: 'visit-soderhamn',
      address: { address: 'Köpmangatan 11', city: 'Söderhamn' },
      scan: {},
    });
    const filled = await fillPlacePoint(
      chosen,
      lookups({
        geocodeStreet: async () => point,
        findVenue: async () => ({ point: { lat: 1, lng: 2 }, rank: 'places' }),
      }),
    );
    expect(filled.pointRank).toBe('address');
    expect(filled.point).toEqual(point);
  });

  it('asks Places when the stored venue point is only the town', async () => {
    const calls: string[] = [];
    const filled = await fillPlacePoint(
      {
        city: 'Ljusdal',
        venueName: 'Odd Fellow',
        lookup: 'venue',
      },
      lookups({
        findVenue: async () => {
          calls.push('venue');
          return { point: { lat: 61.86, lng: 15.7 }, rank: 'city' };
        },
        findPlaces: async () => {
          calls.push('places');
          return { lat: 61.83, lng: 16.09 };
        },
      }),
    );
    expect(calls).toEqual(['venue', 'places']);
    expect(filled.pointRank).toBe('places');
  });

  it('uses the town when Places finds nothing', async () => {
    const filled = await fillPlacePoint(
      { city: 'Ljusdal', venueName: 'Odd Fellow', lookup: 'venue' },
      lookups({
        cityPoint: async () => ({ lat: 61.83, lng: 16.09 }),
      }),
    );
    expect(filled.pointRank).toBe('city');
  });

  it('does not ask Places for a name that is only the town', async () => {
    let asked = false;
    const filled = await fillPlacePoint(
      { city: 'Bjuråker', lookup: 'city' },
      lookups({
        findPlaces: async () => {
          asked = true;
          return point;
        },
        cityPoint: async () => point,
      }),
    );
    expect(asked).toBe(false);
    expect(filled.pointRank).toBe('city');
  });
});

describe('pointRankBeats', () => {
  it('ranks a scraped point above a city point', () => {
    expect(pointRankBeats('scraped', 'city')).toBe(true);
    expect(pointRankBeats('city', 'scraped')).toBe(false);
    expect(pointRankBeats('places', 'places')).toBe(false);
  });
});

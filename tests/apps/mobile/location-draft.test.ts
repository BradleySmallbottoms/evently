import { describe, expect, it } from 'vitest';

import { pointForPlace, tagsForLocationDraft } from '../../../apps/mobile/src/lib/location-draft';

const nearby = 'nearby';

describe('pointForPlace', () => {
  it('uses the device fix for nearby and the area center otherwise', () => {
    const areas = [
      {
        id: 'area-1',
        active: true,
        center: { lat: 61.3, lng: 17.05 },
        radiusM: 10_000,
      },
    ];
    expect(pointForPlace(nearby, 25_000, nearby, areas, { lat: 61.1, lng: 16.9 })).toEqual({
      lat: 61.1,
      lng: 16.9,
      radiusM: 25_000,
    });
    expect(pointForPlace(nearby, 25_000, nearby, areas, null)).toBeNull();
    expect(pointForPlace('area-1', 5_000, nearby, areas, null)).toEqual({
      lat: 61.3,
      lng: 17.05,
      radiusM: 5_000,
    });
    expect(pointForPlace('missing', 5_000, nearby, areas, null)).toBeNull();
  });
});

describe('tagsForLocationDraft', () => {
  it('keeps the open tags for the same place and switches with the place', () => {
    const input = {
      currentPlaceId: 'area-1',
      nearbyPlaceId: nearby,
      currentTagIds: ['music'],
      nearbyTagIds: ['sport'],
      areaTagIds: ['culture'],
    };
    expect(tagsForLocationDraft({ ...input, draftPlaceId: 'area-1' })).toEqual(['music']);
    expect(tagsForLocationDraft({ ...input, draftPlaceId: nearby })).toEqual(['sport']);
    expect(tagsForLocationDraft({ ...input, draftPlaceId: 'area-2' })).toEqual(['culture']);
  });
});

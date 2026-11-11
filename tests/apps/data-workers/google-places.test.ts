import { describe, expect, it } from 'vitest';
import { pointFromPlacesResponse } from '../../../apps/data-workers/src/google-places';

const ljusdal = {
  location: { latitude: 61.83, longitude: 16.09 },
  addressComponents: [
    { longText: 'Ljusdal', types: ['locality'] },
    { longText: 'Sweden', shortText: 'SE', types: ['country'] },
  ],
};

describe('pointFromPlacesResponse', () => {
  it('keeps a Swedish place in the town that was asked for', () => {
    expect(pointFromPlacesResponse({ places: [ljusdal] }, 'Ljusdal')).toEqual({
      lat: 61.83,
      lng: 16.09,
    });
  });

  it('rejects a place in another town', () => {
    expect(pointFromPlacesResponse({ places: [ljusdal] }, 'Hudiksvall')).toBeUndefined();
  });

  it('rejects a place outside Sweden', () => {
    expect(
      pointFromPlacesResponse(
        {
          places: [
            {
              location: { latitude: 59.3, longitude: 18.0 },
              addressComponents: [
                { longText: 'Ljusdal', types: ['locality'] },
                { longText: 'Norway', shortText: 'NO', types: ['country'] },
              ],
            },
          ],
        },
        'Ljusdal',
      ),
    ).toBeUndefined();
  });
});

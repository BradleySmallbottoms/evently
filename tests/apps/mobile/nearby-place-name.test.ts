import { describe, expect, it } from 'vitest';

import {
  nearbyLocationDetail,
  placeNameCell,
} from '../../../apps/mobile/src/lib/nearby-place-name';

describe('placeNameCell', () => {
  it('groups a fix of about a kilometre into one lookup', () => {
    expect(placeNameCell(61.3037, 17.0592)).toEqual({ lat: 61.3, lng: 17.06 });
    expect(placeNameCell(61.3049, 17.055)).toEqual(placeNameCell(61.3037, 17.0592));
  });
});

describe('nearbyLocationDetail', () => {
  it('shows the place name under Near you', () => {
    expect(nearbyLocationDetail('nearby', 'Söderhamn')).toBe('Söderhamn');
    expect(nearbyLocationDetail('nearby', '  Bollnäs  ')).toBe('Bollnäs');
  });

  it('stays hidden for a saved place and when the name is missing', () => {
    expect(nearbyLocationDetail('area-1', 'Söderhamn')).toBeUndefined();
    expect(nearbyLocationDetail('nearby', '  ')).toBeUndefined();
    expect(nearbyLocationDetail('nearby', null)).toBeUndefined();
  });
});

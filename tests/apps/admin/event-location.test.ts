import { describe, expect, it } from 'vitest';
import {
  formatMapCoordinate,
  geofenceMeters,
  mapPoint,
} from '../../../apps/admin/src/app/[locale]/events/[id]/components/event-location';

describe('mapPoint', () => {
  it('reads a complete latitude and longitude', () => {
    expect(mapPoint('61.303', '17.059')).toEqual({ lat: 61.303, lng: 17.059 });
  });

  it('ignores a half-typed or one-sided coordinate', () => {
    expect(mapPoint('61.', '17.059')).toBeNull();
    expect(mapPoint('61.303', '')).toBeNull();
    expect(mapPoint('', '')).toBeNull();
    expect(mapPoint('61,303', '17.059')).toBeNull();
  });

  it('rejects a coordinate outside the valid range', () => {
    expect(mapPoint('91', '17')).toBeNull();
    expect(mapPoint('61', '181')).toBeNull();
  });
});

describe('formatMapCoordinate', () => {
  it('keeps six decimal places', () => {
    expect(formatMapCoordinate(61.30381234)).toBe('61.303812');
  });
});

describe('geofenceMeters', () => {
  it('reads a positive whole number of metres', () => {
    expect(geofenceMeters('150')).toBe(150);
  });

  it('draws no circle for an empty, zero, or fractional radius', () => {
    expect(geofenceMeters('')).toBeNull();
    expect(geofenceMeters('0')).toBeNull();
    expect(geofenceMeters('12.5')).toBeNull();
  });
});

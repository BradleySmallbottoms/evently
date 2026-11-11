import { describe, expect, it } from 'vitest';
import {
  coordinateText,
  formatMapCoordinate,
  geofenceMeters,
  mapPoint,
  occasionOptionLabel,
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

describe('coordinateText', () => {
  it('formats a stored point, including one sent as text', () => {
    expect(coordinateText({ lat: 61.8064912, lng: 15.8456252 })).toEqual({
      lat: '61.806491',
      lng: '15.845625',
    });
    expect(coordinateText({ lat: '61.8', lng: '17' })).toEqual({
      lat: '61.800000',
      lng: '17.000000',
    });
  });

  it('is empty when the occasion has no point', () => {
    expect(coordinateText(null)).toEqual({ lat: '', lng: '' });
    expect(coordinateText(undefined)).toEqual({ lat: '', lng: '' });
  });
});

describe('occasionOptionLabel', () => {
  const occasion = {
    startsAt: '2026-06-15T16:00:00.000Z',
    endsAt: '2026-06-15T19:00:00.000Z',
    venueName: ' Kulturhuset ',
  };

  it('joins the start, the end, and the venue', () => {
    const label = occasionOptionLabel(occasion, 'Europe/Stockholm', 'sv-SE');
    expect(label).toContain('Kulturhuset');
    expect(label).toContain('·');
    expect(label).toContain('–');
  });

  it('leaves out an empty venue, and a whole day is one time', () => {
    const label = occasionOptionLabel(
      { ...occasion, endsAt: occasion.startsAt, venueName: '  ' },
      'Europe/Stockholm',
      'en',
    );
    expect(label).not.toContain('·');
    expect(label).not.toContain('–');
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

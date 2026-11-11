import { describe, expect, it } from 'vitest';
import { venueIdentity } from '../../../packages/domain/src/venue';

describe('venueIdentity', () => {
  it('keys a name and city', () => {
    expect(venueIdentity('  Söderhamns   Teater ', 'Söderhamn')).toEqual({
      name: 'Söderhamns Teater',
      city: 'Söderhamn',
      nameKey: 'söderhamns teater',
      cityKey: 'söderhamn',
    });
  });

  it('skips a name that is only the city', () => {
    expect(venueIdentity('Söderhamn', ' söderhamn ')).toEqual({
      name: 'Söderhamn',
      city: 'söderhamn',
      nameKey: 'söderhamn',
      cityKey: 'söderhamn',
    });
    expect(venueIdentity('  ', 'Söderhamn')).toBeUndefined();
    expect(venueIdentity('Teatern', '')).toBeUndefined();
  });
});

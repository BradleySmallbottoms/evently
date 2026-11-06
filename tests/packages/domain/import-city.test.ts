import { describe, expect, it } from 'vitest';
import {
  cityInPlaceText,
  resolveImportCity,
  sourceCity,
} from '../../../packages/domain/src/import-city';

describe('resolveImportCity', () => {
  it('keeps a scraped city', () => {
    expect(
      resolveImportCity({
        city: 'Delsbo',
        placeText: 'Storgatan 1 Hudiksvall',
        fallback: sourceCity('glada-hudik'),
      }),
    ).toBe('Delsbo');
  });

  it('reads the town at the end of a place line', () => {
    expect(cityInPlaceText('Odd Fellow, Kyrkogatan 14 Ljusdal')).toBe('Ljusdal');
    expect(cityInPlaceText('Edsbyns museum')).toBe('Edsbyn');
    expect(
      resolveImportCity({
        placeText: 'Folkets Hus Iggesund, Centralgatan 3 Iggesund',
        fallback: sourceCity('abf-halsingland'),
      }),
    ).toBe('Iggesund');
  });

  it('uses the source city only when the page names none', () => {
    expect(sourceCity('bollnas-kommun')).toBe('Bollnäs');
    expect(sourceCity('abf-halsingland')).toBeUndefined();
    expect(resolveImportCity({ fallback: sourceCity('bollnas-kommun') })).toBe('Bollnäs');
    expect(resolveImportCity({ fallback: sourceCity('folkteatern-gavleborg') })).toBeUndefined();
  });
});

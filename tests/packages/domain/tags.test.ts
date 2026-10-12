import { tagSlug } from '../../../packages/domain/src/tags';
import { describe, expect, it } from 'vitest';

describe('tagSlug', () => {
  it('folds Swedish letters the same way as the seed tags', () => {
    expect(tagSlug('Idrott & Tävlingar')).toBe('idrott-tavlingar');
    expect(tagSlug('Högtider')).toBe('hogtider');
    expect(tagSlug('Jul & Nyår')).toBe('jul-nyar');
    expect(tagSlug('Mässor & Utställningar')).toBe('massor-utstallningar');
    expect(tagSlug('Bandy & Innebandy')).toBe('bandy-innebandy');
    expect(tagSlug('Utställning')).toBe('utstallning');
  });
});

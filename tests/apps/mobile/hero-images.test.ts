import { describe, expect, it } from 'vitest';

import { heroImageUrls } from '../../../apps/mobile/src/lib/hero-images';

describe('heroImageUrls', () => {
  it('puts the hero first and keeps later photos', () => {
    expect(
      heroImageUrls('https://images.example/hero.jpg', [
        'https://images.example/two.jpg',
        'https://images.example/three.jpg',
      ]),
    ).toEqual([
      'https://images.example/hero.jpg',
      'https://images.example/two.jpg',
      'https://images.example/three.jpg',
    ]);
  });

  it('drops empties and duplicates', () => {
    expect(
      heroImageUrls('https://images.example/hero.jpg', [
        'https://images.example/hero.jpg',
        '',
        'https://images.example/two.jpg',
      ]),
    ).toEqual(['https://images.example/hero.jpg', 'https://images.example/two.jpg']);
    expect(heroImageUrls(null, [])).toEqual([]);
  });
});

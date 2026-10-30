import { describe, expect, it } from 'vitest';

import { pickHomeFeaturedEvents } from '../../../apps/mobile/src/lib/home-featured';

describe('pickHomeFeaturedEvents', () => {
  it('keeps featured events in list order, up to six', () => {
    const items = [
      { id: 'a', featured: false },
      { id: 'b', featured: true },
      { id: 'c', featured: true },
      { id: 'd', featured: false },
      { id: 'e', featured: true },
      { id: 'f', featured: true },
      { id: 'g', featured: true },
      { id: 'h', featured: true },
      { id: 'i', featured: true },
    ];
    expect(pickHomeFeaturedEvents(items).map((event) => event.id)).toEqual([
      'b',
      'c',
      'e',
      'f',
      'g',
      'h',
    ]);
  });

  it('returns nothing when no event is featured', () => {
    expect(
      pickHomeFeaturedEvents([
        { id: 'a', featured: false },
        { id: 'b', featured: false },
      ]),
    ).toEqual([]);
  });
});

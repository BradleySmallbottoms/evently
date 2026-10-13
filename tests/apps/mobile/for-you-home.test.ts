import { describe, expect, it } from 'vitest';

import {
  FOR_YOU_HOME_COUNT,
  FOR_YOU_HOME_FETCH,
  forYouHomeItems,
} from '../../../apps/mobile/src/lib/for-you-home';

function item(id: string) {
  return { id };
}

describe('forYouHomeItems', () => {
  it('drops events already in the featured row and keeps the carousel full', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(item);
    const picked = forYouHomeItems(items, new Set(['b', 'd']), 3);
    expect(picked.map((event) => event.id)).toEqual(['a', 'c', 'e']);
  });

  it('stops at the carousel count after skipping featured events', () => {
    const items = Array.from({ length: FOR_YOU_HOME_COUNT + 4 }, (_, index) => item(String(index)));
    const featured = new Set(['0', '1']);
    const picked = forYouHomeItems(items, featured);
    expect(picked).toHaveLength(FOR_YOU_HOME_COUNT);
    expect(picked.some((event) => featured.has(event.id))).toBe(false);
    expect(picked[0]?.id).toBe('2');
  });

  it('returns a shorter row when every remaining event is featured', () => {
    expect(forYouHomeItems([item('a')], new Set(['a']))).toEqual([]);
  });

  it('still fills the carousel when a home page of featured events comes first', () => {
    const featured = Array.from({ length: 20 }, (_, index) => item(`featured-${index}`));
    const rest = Array.from({ length: FOR_YOU_HOME_COUNT }, (_, index) => item(`next-${index}`));
    const items = [...featured, ...rest];
    expect(items).toHaveLength(FOR_YOU_HOME_FETCH);
    const picked = forYouHomeItems(items, new Set(featured.map((event) => event.id)));
    expect(picked.map((event) => event.id)).toEqual(rest.map((event) => event.id));
  });
});

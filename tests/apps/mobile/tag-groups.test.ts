import { describe, expect, it } from 'vitest';

import {
  groupHomeTags,
  homeGroupForTags,
  HOME_TAG_GROUPS,
  parseHomeTagIds,
  retainedTagIds,
  toggleGroupSelection,
  toggleTagSelection,
  type HomeTag,
} from '../../../apps/mobile/src/lib/tag-groups';

function tag(slug: string, id = slug): HomeTag {
  return { id, slug, name: slug };
}

describe('groupHomeTags', () => {
  it('puts each listed slug in one group and leaves no duplicates', () => {
    const seen = new Set<string>();
    for (const group of HOME_TAG_GROUPS) {
      for (const slug of group.slugs) {
        expect(seen.has(slug)).toBe(false);
        seen.add(slug);
      }
    }
  });

  it('buckets known tags and sends an unknown slug to Övrigt', () => {
    const groups = groupHomeTags([
      tag('konsert'),
      tag('fotboll'),
      tag('mat-dryck'),
      tag('nagon-ny-tagg'),
    ]);
    const byId = new Map(groups.map((group) => [group.id, group.tags.map((item) => item.slug)]));
    expect(byId.get('music')).toEqual(['konsert']);
    expect(byId.get('sport')).toEqual(['fotboll']);
    expect(byId.get('other')).toEqual(['mat-dryck', 'nagon-ny-tagg']);
    expect(byId.has('family')).toBe(false);
  });
});

describe('homeGroupForTags', () => {
  it('uses the first group that contains one of the event tags', () => {
    const tags = [tag('konsert', 'music-1'), tag('fotboll', 'sport-1')];
    expect(homeGroupForTags(tags, ['sport-1', 'music-1'])).toBe('music');
    expect(homeGroupForTags(tags, ['missing'])).toBeUndefined();
  });
});

describe('home tag selection', () => {
  it('selects a whole group, then clears it when every tag is on', () => {
    const ids = ['a', 'b'];
    expect(toggleGroupSelection([], ids)).toEqual(['a', 'b']);
    expect(toggleGroupSelection(['a'], ids)).toEqual(['a', 'b']);
    expect(toggleGroupSelection(['a', 'b', 'c'], ids)).toEqual(['c']);
  });

  it('clears a partly selected home group instead of filling it in', () => {
    const ids = ['a', 'b'];
    expect(toggleGroupSelection(['a', 'c'], ids, 'any')).toEqual(['c']);
    expect(toggleGroupSelection(['a', 'b', 'c'], ids, 'any')).toEqual(['c']);
    expect(toggleGroupSelection(['c'], ids, 'any')).toEqual(['c', 'a', 'b']);
  });

  it('toggles a single tag without clearing the rest of the group', () => {
    expect(toggleTagSelection(['a', 'b'], 'b')).toEqual(['a']);
    expect(toggleTagSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('reads a stored id list and drops ids that are no longer tags', () => {
    const id = 'a0000000-0000-4000-8000-000000000001';
    expect(parseHomeTagIds(null)).toEqual([]);
    expect(parseHomeTagIds('nope')).toEqual([]);
    expect(parseHomeTagIds('{"a":1}')).toEqual([]);
    expect(parseHomeTagIds(JSON.stringify([id, '', 'nope', 1]))).toEqual([id]);
    expect(retainedTagIds([id, 'gone', 'b'], new Set(['b', id]))).toEqual([id, 'b']);
  });
});

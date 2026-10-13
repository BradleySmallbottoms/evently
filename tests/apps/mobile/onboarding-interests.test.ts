import { describe, expect, it } from 'vitest';

import {
  isInterestSelected,
  ONBOARDING_INTERESTS,
  tagsForInterest,
  visibleInterests,
} from '../../../apps/mobile/src/lib/onboarding-interests';
import { HOME_TAG_GROUPS, toggleGroupSelection, type HomeTag } from '../../../apps/mobile/src/lib/tag-groups';

function tag(slug: string, id = slug): HomeTag {
  return { id, slug, name: slug };
}

describe('onboarding interests', () => {
  it('assigns every home tag slug to one interest', () => {
    const seen = new Set<string>();
    for (const interest of ONBOARDING_INTERESTS) {
      for (const slug of interest.slugs) {
        expect(seen.has(slug)).toBe(false);
        seen.add(slug);
      }
    }
    const home = new Set(HOME_TAG_GROUPS.flatMap((group) => [...group.slugs]));
    expect(seen).toEqual(home);
  });

  it('hides an interest that has no loaded tags', () => {
    const tags = [tag('konsert'), tag('fotboll')];
    expect(visibleInterests(tags)).toEqual(['music', 'sport']);
    expect(tagsForInterest(tags, 'music').map((item) => item.id)).toEqual(['konsert']);
  });

  it('selects and clears every tag in the interest', () => {
    const tags = [tag('konsert', 'a'), tag('fest', 'b'), tag('fotboll', 'c')];
    const musicIds = tagsForInterest(tags, 'music').map((item) => item.id);
    const selected = toggleGroupSelection([], musicIds);
    expect(isInterestSelected(selected, musicIds)).toBe(true);
    expect(selected).toEqual(['a', 'b']);
    expect(isInterestSelected(toggleGroupSelection(selected, musicIds), musicIds)).toBe(false);
  });
});

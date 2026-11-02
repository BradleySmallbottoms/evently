import { describe, expect, it } from 'vitest';

import { areaDraftIsDirty } from '../../../apps/mobile/src/lib/area-draft';

const saved = {
  name: 'Söderhamn',
  tagIds: ['a', 'b'],
  searchRadiusM: 25_000,
  notify: true,
  active: true,
  notifyRadiusM: 25_000,
};

describe('areaDraftIsDirty', () => {
  it('stays clean when the tags are the same set', () => {
    expect(areaDraftIsDirty({ ...saved, tagIds: ['b', 'a'] }, saved)).toBe(false);
  });

  it('is dirty when a tag, the name, or a radius changed', () => {
    expect(areaDraftIsDirty({ ...saved, tagIds: ['a'] }, saved)).toBe(true);
    expect(areaDraftIsDirty({ ...saved, name: 'Hudiksvall' }, saved)).toBe(true);
    expect(areaDraftIsDirty({ ...saved, name: '  Söderhamn  ' }, saved)).toBe(false);
    expect(areaDraftIsDirty({ ...saved, searchRadiusM: 50_000 }, saved)).toBe(true);
    expect(areaDraftIsDirty({ ...saved, notify: false, notifyRadiusM: null }, saved)).toBe(true);
    expect(
      areaDraftIsDirty(
        { ...saved, notify: false, notifyRadiusM: 50_000 },
        { ...saved, notify: false, notifyRadiusM: null },
      ),
    ).toBe(false);
    expect(areaDraftIsDirty({ ...saved, notifyRadiusM: 10_000 }, saved)).toBe(true);
    expect(areaDraftIsDirty({ ...saved, active: false }, saved)).toBe(true);
  });
});

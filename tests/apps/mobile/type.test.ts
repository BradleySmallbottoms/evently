import { describe, expect, it } from 'vitest';

import { manrope, manropeFamily } from '../../../apps/mobile/src/theme/type';

describe('manropeFamily', () => {
  it('maps the type scale onto Manrope faces', () => {
    expect(manropeFamily('800')).toBe(manrope.extrabold);
    expect(manropeFamily(700)).toBe(manrope.bold);
    expect(manropeFamily('600')).toBe(manrope.semibold);
    expect(manropeFamily('500')).toBe(manrope.medium);
    expect(manropeFamily('400')).toBe(manrope.regular);
    expect(manropeFamily('bold')).toBe(manrope.bold);
    expect(manropeFamily(undefined)).toBe(manrope.regular);
  });
});

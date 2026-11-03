import { describe, expect, it } from 'vitest';

import { parseAppearance, resolveAppearance } from '../../../apps/mobile/src/lib/appearance';

describe('appearance', () => {
  it('treats a missing or unknown preference as system', () => {
    expect(parseAppearance(null)).toBe('system');
    expect(parseAppearance(undefined)).toBe('system');
    expect(parseAppearance('sepia')).toBe('system');
    expect(parseAppearance('dark')).toBe('dark');
  });

  it('follows the device unless the preference is light or dark', () => {
    expect(resolveAppearance('system', 'dark')).toBe('dark');
    expect(resolveAppearance('system', 'light')).toBe('light');
    expect(resolveAppearance('system', null)).toBe('light');
    expect(resolveAppearance('light', 'dark')).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
  });
});

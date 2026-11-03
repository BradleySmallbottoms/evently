import { afterEach, describe, expect, it } from 'vitest';

import {
  appliedColorScheme,
  applyColorScheme,
  categoryColors,
  colors,
} from '../../../apps/mobile/src/theme/colors';

describe('color palette', () => {
  afterEach(() => {
    applyColorScheme('light');
  });

  it('uses the light berry palette by default', () => {
    applyColorScheme('light');
    expect(colors.canvas).toBe('#F5F0E8');
    expect(colors.ink).toBe('#282423');
    expect(colors.primary).toBe('#963B50');
    expect(colors.primaryPressed).toBe('#702C3B');
    expect(categoryColors.music.fill).toBe('#F2E2E6');
    expect(categoryColors.music.icon).toBe('#963B50');
    expect(categoryColors.sports.fill).toBe('#DFECE6');
  });

  it('switches surfaces, text, and category tints for dark mode', () => {
    applyColorScheme('dark');
    expect(colors.canvas).toBe('#19191B');
    expect(colors.card).toBe('#242427');
    expect(colors.ink).toBe('#F5F0E8');
    expect(colors.primary).toBe('#B85B72');
    expect(colors.danger).toBe('#F0787D');
    expect(categoryColors.music.fill).toBe('#482631');
    expect(categoryColors.music.icon).toBe('#F2E2E6');
    expect(categoryColors.holidays.icon).toBe('#F2E9D2');
    expect(appliedColorScheme()).toBe('dark');
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  appliedColorScheme,
  applyColorScheme,
  categoryColors,
  colors,
  splashColors,
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

  it('uses the splash artwork colors for each scheme', () => {
    expect(splashColors('light')).toEqual({
      background: '#FFF8F0',
      logo: '#963B50',
      text: '#282423',
      subtitle: '#877B74',
      wave1: '#F2D0D0',
      wave2: '#CF8C9D',
      wave3: '#963B50',
    });
    expect(splashColors('dark')).toEqual({
      background: '#19191B',
      logo: '#B85B72',
      text: '#F5F0E8',
      subtitle: '#B8B1AC',
      wave1: '#343438',
      wave2: '#702C3B',
      wave3: '#963B50',
    });
  });
});

import { colors, palette } from '@/theme/colors';
import { space } from '@/theme/tokens';

export const Colors = {
  light: {
    text: palette.light.text,
    background: palette.light.background,
    backgroundElement: palette.light.surface,
    backgroundSelected: palette.brand.berrySubtle,
    textSecondary: palette.light.textSecondary,
  },
  dark: {
    text: palette.dark.text,
    background: palette.dark.background,
    backgroundElement: palette.dark.surface,
    backgroundSelected: palette.categories.music.dark,
    textSecondary: palette.dark.textSecondary,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export { colors, palette };
export const Spacing = {
  half: space.xs / 2,
  one: space.xs,
  two: space.sm,
  three: space.lg,
  four: space.xxl,
  five: space.xxxl,
  six: 64,
} as const;

export const MaxContentWidth = 800;
export const BottomTabInset = 80;

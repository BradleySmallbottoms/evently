import { brand, colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export const Colors = {
  light: {
    text: brand.text,
    background: brand.background,
    backgroundElement: brand.surface,
    backgroundSelected: brand.accentSoft,
    textSecondary: brand.textSecondary,
  },
  dark: {
    text: brand.text,
    background: brand.background,
    backgroundElement: brand.surface,
    backgroundSelected: brand.accentSoft,
    textSecondary: brand.textSecondary,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export { colors, brand };
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

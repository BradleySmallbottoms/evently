import { brand, colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export const Colors = {
  light: {
    text: brand.ink,
    background: brand.canvas,
    backgroundElement: brand.card,
    backgroundSelected: brand.accentSoft,
    textSecondary: brand.inkMuted,
  },
  dark: {
    text: '#F5F5F5',
    background: '#121212',
    backgroundElement: '#1E1E1E',
    backgroundSelected: '#3A241C',
    textSecondary: '#B0B0B0',
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

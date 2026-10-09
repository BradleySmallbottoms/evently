export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  family: 'PlusJakartaSans_500Medium',
  familyBold: 'PlusJakartaSans_700Bold',
  familySemi: 'PlusJakartaSans_600SemiBold',
  familyRegular: 'PlusJakartaSans_400Regular',
} as const;

export const shadow = {
  card: '0 8px 24px rgba(20, 20, 20, 0.08)',
  soft: '0 2px 10px rgba(20, 20, 20, 0.06)',
} as const;

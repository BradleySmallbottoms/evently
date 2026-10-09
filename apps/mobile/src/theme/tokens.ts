export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

/** Large continuous radii — Events Booking Dribbble language. */
export const radius = {
  sm: 14,
  md: 20,
  lg: 28,
  xl: 32,
  pill: 999,
} as const;

export const typography = {
  family: 'PlusJakartaSans_500Medium',
  familyBold: 'PlusJakartaSans_700Bold',
  familySemi: 'PlusJakartaSans_600SemiBold',
  familyRegular: 'PlusJakartaSans_400Regular',
} as const;

export const shadow = {
  card: '0 12px 32px rgba(20, 20, 20, 0.1)',
  soft: '0 4px 14px rgba(20, 20, 20, 0.06)',
  cta: '0 10px 28px rgba(255, 106, 61, 0.35)',
} as const;

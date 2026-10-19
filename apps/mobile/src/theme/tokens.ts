export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Cards 20, buttons and search 14, chips fully round. */
export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 14,
  pill: 999,
} as const;

export const shadow = {
  card: '0 8px 24px rgba(17, 24, 32, 0.06)',
  soft: '0 2px 8px rgba(17, 24, 32, 0.04)',
  hard: '0 4px 12px rgba(17, 24, 32, 0.08)',
} as const;

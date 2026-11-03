/** Manrope faces loaded in the root layout. Weights follow the type spec. */
export const manrope = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
} as const;

const familyByWeight: Record<string, string> = {
  '400': manrope.regular,
  '500': manrope.medium,
  '600': manrope.semibold,
  '700': manrope.bold,
  '800': manrope.extrabold,
  normal: manrope.regular,
  bold: manrope.bold,
};

/** The Manrope file for a React Native fontWeight. Unknown weights use Regular. */
export function manropeFamily(weight: unknown): string {
  const key = typeof weight === 'number' ? String(weight) : weight;
  if (typeof key !== 'string') return manrope.regular;
  return familyByWeight[key] ?? manrope.regular;
}

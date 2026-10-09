import { Platform } from 'react-native';
import { Color } from 'expo-router';

/** Brand accents from the Events Booking Dribbble reference (coral + soft canvas). */
export const brand = {
  accent: '#FF6A3D',
  accentSoft: '#FFE4DA',
  accentDeep: '#E8542A',
  canvas: '#F6F4F1',
  card: '#FFFFFF',
  ink: '#141414',
  inkMuted: '#6B6B6B',
  inkFaint: '#9A9A9A',
  line: '#E8E4DF',
  success: '#1F8A5B',
  danger: '#D64545',
} as const;

export const colors = {
  background: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.background,
    default: brand.canvas,
  })!,
  card: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surface,
    default: brand.card,
  })!,
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: brand.ink,
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: brand.inkMuted,
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: brand.line,
  })!,
  accent: brand.accent,
  accentSoft: brand.accentSoft,
  accentDeep: brand.accentDeep,
  canvas: brand.canvas,
  ink: brand.ink,
  inkMuted: brand.inkMuted,
  inkFaint: brand.inkFaint,
  line: brand.line,
  success: brand.success,
  danger: brand.danger,
} as const;

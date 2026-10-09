import { Text as RNText, type TextProps } from 'react-native';

import { colors } from '@/theme/colors';
import { typography } from '@/theme/tokens';

type Variant = 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';

const variantStyle: Record<Variant, object> = {
  hero: { fontFamily: typography.familyBold, fontSize: 28, lineHeight: 34, color: colors.ink },
  title: { fontFamily: typography.familyBold, fontSize: 22, lineHeight: 28, color: colors.ink },
  subtitle: {
    fontFamily: typography.familySemi,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  body: {
    fontFamily: typography.familyRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  caption: {
    fontFamily: typography.familyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkMuted,
  },
  label: {
    fontFamily: typography.familySemi,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkMuted,
  },
};

export function AppText({
  variant = 'body',
  style,
  ...props
}: TextProps & { variant?: Variant }) {
  return <RNText selectable style={[variantStyle[variant], style]} {...props} />;
}

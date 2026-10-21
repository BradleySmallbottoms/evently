import { Text as RNText, type TextProps } from 'react-native';

import { colors } from '@/theme/colors';

type Variant = 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';

const variantStyle: Record<Variant, object> = {
  hero: { fontSize: 32, lineHeight: 36, fontWeight: '700', color: colors.ink },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', color: colors.ink },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', color: colors.ink },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', color: colors.inkMuted },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.inkMuted },
};

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <RNText selectable style={[variantStyle[variant], style]} {...props} />;
}

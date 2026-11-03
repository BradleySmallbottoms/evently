import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { useAppearance } from '@/lib/appearance-context';
import { colors } from '@/theme/colors';
import { manropeFamily } from '@/theme/type';

type Variant = 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';

const variantStyle: Record<
  Variant,
  { fontSize: number; lineHeight: number; fontWeight: '400' | '500' | '600' | '700' | '800' }
> = {
  hero: { fontSize: 32, lineHeight: 36, fontWeight: '800' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  subtitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
};

const variantColor: Record<Variant, 'ink' | 'inkMuted'> = {
  hero: 'ink',
  title: 'ink',
  subtitle: 'ink',
  body: 'ink',
  caption: 'inkMuted',
  label: 'inkMuted',
};

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const { scheme } = useAppearance();
  const flat = StyleSheet.flatten([variantStyle[variant], style]) as TextStyle | undefined;
  const color = flat?.color ?? colors[variantColor[variant]];
  return (
    <RNText
      // iOS keeps the previous color on a custom font until the text view is recreated.
      key={scheme}
      selectable
      style={[
        variantStyle[variant],
        style,
        {
          fontFamily: manropeFamily(flat?.fontWeight),
          fontWeight: 'normal',
          color,
        },
      ]}
      {...props}
    />
  );
}

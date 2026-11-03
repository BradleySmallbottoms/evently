import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useSchemeKey } from '@/lib/appearance-context';
import { colors } from '@/theme/colors';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Page fill. Explore sits on the photo scrim. */
  background?: 'canvas' | 'overlay';
  onLayout?: ViewProps['onLayout'];
};

/** Rebuilds the page when the scheme changes so native views take the new colors. */
export function ThemedScreen({ children, style, background = 'canvas', onLayout }: Props) {
  const paint = useSchemeKey();
  return (
    <View
      key={paint}
      collapsable={false}
      onLayout={onLayout}
      style={[
        { flex: 1, backgroundColor: background === 'overlay' ? colors.overlay : colors.canvas },
        style,
      ]}
    >
      {children}
    </View>
  );
}

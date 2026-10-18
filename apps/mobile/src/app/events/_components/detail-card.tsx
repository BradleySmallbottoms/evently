import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

/** White section on the detail canvas, matching the event-detail mock. */
export function DetailCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.cardDarker,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        padding: space.lg,
        boxShadow: shadow.card,
      }}
    >
      {children}
    </View>
  );
}

import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

/** Small date label sitting on a photo. */
export function DatePill({ label }: { label: string }) {
  if (label.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        backgroundColor: colors.card,
        borderRadius: radius.pill,
        paddingHorizontal: space.sm,
        paddingVertical: 4,
        boxShadow: shadow.hard,
      }}
    >
      <AppText
        variant="label"
        numberOfLines={1}
        style={{ color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: '700' }}
      >
        {label}
      </AppText>
    </View>
  );
}

import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
};

/**
 * Compact date control for Android/web.
 * Native DatePicker lives in `date-filter.ios.tsx` via SwiftUI.
 */
export function DateFilter({ label, value, onChange }: Props) {
  return (
    <Pressable
      onPress={() => {
        const next = new Date(value);
        next.setDate(next.getDate() + 1);
        onChange(next);
      }}
      style={{
        backgroundColor: colors.card as string,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <View style={{ gap: 2 }}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="subtitle">{value.toLocaleDateString()}</AppText>
      </View>
    </Pressable>
  );
}

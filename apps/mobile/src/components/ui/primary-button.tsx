import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ label, onPress, loading, disabled, style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          backgroundColor: colors.accent,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          paddingVertical: space.lg,
          paddingHorizontal: space.xxl,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled || loading ? 0.5 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <AppText variant="subtitle" style={{ color: '#FFFFFF' }}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

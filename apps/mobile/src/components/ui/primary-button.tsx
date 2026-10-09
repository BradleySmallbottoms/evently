import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

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
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            {
              backgroundColor: colors.accent,
              borderRadius: radius.xl,
              borderCurve: 'continuous',
              paddingVertical: space.lg + 2,
              paddingHorizontal: space.xxl,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled || loading ? 0.5 : 1,
              boxShadow: shadow.cta,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              transitionProperty: 'transform',
              transitionDuration: 120,
            },
            style,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <AppText variant="subtitle" style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {label}
            </AppText>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

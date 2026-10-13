import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Override the default brand accent (e.g. per-step onboarding colors). */
  color?: string;
  /** Trailing arrow, used by the onboarding interest step. */
  arrow?: boolean;
  /** Checkmark, used by the onboarding interest step. */
  checkmark?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ label, onPress, loading, disabled, color, arrow, checkmark, style }: Props) {
  const backgroundColor = color ?? colors.accent;
  const labelColor = colors.primary;
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
              backgroundColor,
              borderRadius: radius.xl,
              borderCurve: 'continuous',
              paddingVertical: space.lg,
              paddingHorizontal: space.xxl,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 52,
              opacity: disabled || loading ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              transitionProperty: 'transform',
              transitionDuration: 120,
            },
            style,
          ]}
        >
          {loading ? (
            <ActivityIndicator color={labelColor} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <AppText variant="subtitle" style={{ color: labelColor, fontWeight: '700' }}>
                {label}
              </AppText>
              {arrow ? (
                process.env.EXPO_OS === 'ios' ? (
                  <SymbolView name="arrow.right" size={18} tintColor={labelColor} weight="semibold" />
                ) : (
                  <MaterialIcons name="arrow-forward" size={18} color={labelColor} />
                )
              ) : (checkmark ? (
                process.env.EXPO_OS === 'ios' ? (
                  <SymbolView name="checkmark" size={18} tintColor={labelColor} weight="semibold" />
                ) : (
                  <MaterialIcons name="check" size={18} color={labelColor} />
                )
              ): null)}
            </View>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

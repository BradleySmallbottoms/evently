import { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/tokens';

/** Pulsing placeholder. Stays still when the system asks for reduced motion. */
export function SkeletonBlock({
  width,
  height,
  radius: corner = radius.pill,
  color = colors.line,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: reduced ? 1 : opacity.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width, height, borderRadius: corner, backgroundColor: color }, pulse, style]}
    />
  );
}

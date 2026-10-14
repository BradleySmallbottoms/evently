import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, Keyframe, cubicBezier, useReducedMotion } from 'react-native-reanimated';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

const CHECK_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.92 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(240);

const CHECK_IN_REDUCED = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1 },
}).duration(120);

const CONFIRM_HOLD_MS = 720;
const CONFIRM_HOLD_REDUCED_MS = 240;

export type ButtonIcon = {
  sf: SFSymbol;
  md: keyof typeof MaterialIcons.glyphMap;
};

type Props = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Override the default brand accent (e.g. per-step onboarding colors). */
  color?: string;
  /** Icon on the left of the label. */
  icon?: ButtonIcon;
  /** Trailing arrow, used by the onboarding interest step. */
  arrow?: boolean;
  /** Checkmark, used by the onboarding interest step. */
  checkmark?: boolean;
  /**
   * Fade the button green and reveal a checkmark, then call `onConfirmed`.
   * Used after an onboarding step succeeds.
   */
  confirmed?: boolean;
  onConfirmed?: () => void;
  /** Fade the button red and reveal a cross. Used when a permission is declined. */
  rejected?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  color,
  icon,
  arrow,
  checkmark,
  confirmed = false,
  onConfirmed,
  rejected = false,
  style,
}: Props) {
  const backgroundColor = color ?? colors.accent;
  const labelColor = colors.primary;
  const reduced = useReducedMotion();
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const showCheck = (checkmark || confirmed) && !rejected;
  const showCross = rejected && !confirmed;
  const locked = disabled || loading || confirmed;
  const colorDuration = reduced ? 350 : 580;

  useEffect(() => {
    if (!confirmed) return;
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const hold = reduced ? CONFIRM_HOLD_REDUCED_MS : CONFIRM_HOLD_MS;
    const timer = setTimeout(() => onConfirmedRef.current?.(), hold);
    return () => clearTimeout(timer);
  }, [confirmed, reduced]);

  useEffect(() => {
    if (!rejected || confirmed) return;
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [confirmed, rejected]);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={locked}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
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
              height: 52,
              paddingHorizontal: space.xxl,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              opacity: (disabled || loading) && !confirmed && !rejected ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              transitionProperty: 'transform',
              transitionDuration: 120,
            },
            style,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: colors.secondarySoftAlpha,
              opacity: confirmed ? 1 : 0,
              transitionProperty: 'opacity',
              transitionDuration: colorDuration,
              transitionTimingFunction: CSS_EASE_OUT,
            }}
          />
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: colors.dangerSoft,
              opacity: rejected && !confirmed ? 1 : 0,
              transitionProperty: 'opacity',
              transitionDuration: colorDuration,
              transitionTimingFunction: CSS_EASE_OUT,
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {icon ? <ButtonGlyph icon={icon} color={labelColor} /> : null}
            {loading && !confirmed ? (
              <ActivityIndicator color={labelColor} />
            ) : (
              <AppText variant="subtitle" style={{ color: labelColor, fontWeight: '700' }}>
                {label}
              </AppText>
            )}
            {arrow && !loading ? (
              process.env.EXPO_OS === 'ios' ? (
                <SymbolView name="arrow.right" size={18} tintColor={labelColor} weight="semibold" />
              ) : (
                <MaterialIcons name="arrow-forward" size={18} color={labelColor} />
              )
            ) : null}
            {showCross && !loading ? (
              <Animated.View
                entering={reduced ? CHECK_IN_REDUCED : CHECK_IN}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {process.env.EXPO_OS === 'ios' ? (
                  <SymbolView name="xmark" size={18} tintColor={colors.danger} weight="bold" />
                ) : (
                  <MaterialIcons name="close" size={20} color={colors.danger} />
                )}
              </Animated.View>
            ) : null}
            {showCheck && !loading ? (
              <Animated.View
                entering={confirmed ? (reduced ? CHECK_IN_REDUCED : CHECK_IN) : undefined}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {process.env.EXPO_OS === 'ios' ? (
                  <SymbolView name="checkmark" size={18} tintColor={labelColor} weight="bold" />
                ) : (
                  <MaterialIcons name="check" size={20} color={labelColor} />
                )}
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

function ButtonGlyph({ icon, color }: { icon: ButtonIcon; color: string }) {
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={icon.sf} size={18} tintColor={color} weight="semibold" />
  ) : (
    <MaterialIcons name={icon.md} size={18} color={color} />
  );
}

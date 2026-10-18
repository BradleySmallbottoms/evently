import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, Keyframe, cubicBezier, useReducedMotion } from 'react-native-reanimated';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** Skip the spinner for taps that resolve into confirm/reject before this. */
const LOADING_INDICATOR_DELAY_MS = 280;

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
  /** Label and icon color. Defaults to the dark primary, which sits on the accent. */
  labelColor?: string;
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
  labelColor,
  icon,
  arrow,
  checkmark,
  confirmed = false,
  onConfirmed,
  rejected = false,
  style,
}: Props) {
  const backgroundColor = color ?? colors.accent;
  const textColor = labelColor ?? colors.primary;
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const onConfirmedRef = useRef(onConfirmed);
  const showCheck = (checkmark || confirmed) && !rejected;
  const showCross = rejected && !confirmed;
  const locked = disabled || loading || confirmed;
  const flex = StyleSheet.flatten(style)?.flex;
  const loadingVisible = Boolean(loading) && !confirmed && !rejected;
  if (!loadingVisible && showLoading) setShowLoading(false);
  const pending = loadingVisible && showLoading;
  const dimmed = Boolean(disabled) && !confirmed && !rejected;

  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  }, [onConfirmed]);

  useEffect(() => {
    if (!loadingVisible) return;
    const timer = setTimeout(() => setShowLoading(true), LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loadingVisible]);

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
      accessibilityState={{ disabled: locked, busy: Boolean(loading) }}
      disabled={disabled || confirmed}
      pressRetentionOffset={16}
      style={flex != null ? { flex } : undefined}
      onPressIn={() => {
        if (locked) return;
        setPressed(true);
      }}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        if (locked) return;
        if (process.env.EXPO_OS === 'ios') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        onPress?.();
      }}
    >
      <Animated.View
        style={[pressStyle, pressed && !reduced && pressInStyle, flex != null ? { flex } : null]}
      >
        <View style={[styles.face, { backgroundColor, opacity: dimmed ? 0.5 : 1 }, style]}>
          <Animated.View
            pointerEvents="none"
            collapsable={false}
            style={[
              reduced ? washReducedStyle : washStyle,
              styles.washConfirm,
              confirmed && washOnStyle,
            ]}
          />
          <Animated.View
            pointerEvents="none"
            collapsable={false}
            style={[
              reduced ? washReducedStyle : washStyle,
              styles.washReject,
              showCross && washOnStyle,
            ]}
          />
          <View style={styles.content}>
            {icon ? <ButtonGlyph icon={icon} color={textColor} /> : null}
            {pending ? (
              <ActivityIndicator color={textColor} />
            ) : (!confirmed && !rejected ? (
              <AppText variant="subtitle" style={{ color: textColor, fontWeight: '700' }}>
                {label}
              </AppText>
            ) : null)}
            {arrow && !pending ? (
              process.env.EXPO_OS === 'ios' ? (
                <SymbolView name="arrow.right" size={18} tintColor={textColor} weight="semibold" />
              ) : (
                <MaterialIcons name="arrow-forward" size={18} color={textColor} />
              )
            ) : null}
            {showCross && !pending ? (
              <StatusMark sf="xmark" md="close" color={colors.danger} reduced={reduced} enter />
            ) : null}
            {showCheck && !pending ? (
              <StatusMark
                sf="checkmark"
                md="check"
                color={confirmed ? '#FFFFFF' : textColor}
                reduced={reduced}
                enter={confirmed}
                glow={confirmed}
              />
            ) : null}
          </View>
        </View>
      </Animated.View>
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

function StatusMark({
  sf,
  md,
  color,
  reduced,
  enter,
  glow = false,
}: {
  sf: SFSymbol;
  md: keyof typeof MaterialIcons.glyphMap;
  color: string;
  reduced: boolean;
  enter: boolean;
  glow?: boolean;
}) {
  return (
    <Animated.View
      entering={enter ? (reduced ? CHECK_IN_REDUCED : CHECK_IN) : undefined}
      style={styles.status}
    >
      {/* {glow ? <View style={styles.checkGlow} /> : null} */}
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={sf} size={20} tintColor={color} weight="bold" />
      ) : (
        <MaterialIcons name={md} size={22} color={color} />
      )}
    </Animated.View>
  );
}

const pressStyle = {
  transform: [{ scale: 1 }],
  transitionProperty: 'transform',
  transitionDuration: '120ms',
  transitionTimingFunction: CSS_EASE_OUT,
} as const;

const pressInStyle = {
  transform: [{ scale: 0.97 }],
} as const;

const washStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  opacity: 0,
  transitionProperty: 'opacity',
  transitionDuration: '580ms',
  transitionTimingFunction: CSS_EASE_OUT,
} as const;

const washReducedStyle = {
  ...washStyle,
  transitionDuration: '350ms',
} as const;

const washOnStyle = { opacity: 1 } as const;

const styles = StyleSheet.create({
  face: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    height: 52,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  washConfirm: {
    backgroundColor: colors.secondary,
  },
  washReject: {
    backgroundColor: colors.dangerSoft,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  status: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlow: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.42)',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
  },
});

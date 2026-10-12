import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, shadow } from '@/theme/tokens';

type Props = {
  /** SF Symbol name — used on iOS. */
  sf: string;
  /** Material Icons name — used on Android and web (SF Symbols are iOS-only). */
  md: keyof typeof MaterialIcons.glyphMap;
  onPress?: () => void;
  badge?: boolean;
  /** Icon only, no circular fill. Use on photos. */
  plain?: boolean;
  tintColor?: string;
  /** Glyph size. Defaults to 20 on iOS and 22 elsewhere. */
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
};

export function CircleIconButton({
  sf,
  md,
  onPress,
  badge,
  plain,
  tintColor,
  iconSize,
  style,
  accessibilityLabel,
}: Props) {
  const tint = tintColor ?? (plain ? '#FFFFFF' : (colors.ink as string));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress?.();
      }}
      style={[
        plain
          ? {
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }
          : {
              width: 46,
              height: 46,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(255,255,255,0.96)',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: shadow.soft,
              borderCurve: 'continuous' as const,
            },
        style,
      ]}
    >
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={sf as never} size={iconSize ?? 20} tintColor={tint} />
      ) : (
        <MaterialIcons name={md} size={iconSize ?? 22} color={tint} />
      )}
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 10,
            right: 11,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.accent,
          }}
        />
      ) : null}
    </Pressable>
  );
}

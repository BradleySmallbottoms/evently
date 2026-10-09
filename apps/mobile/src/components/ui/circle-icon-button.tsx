import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, shadow } from '@/theme/tokens';

type Props = {
  sf: string;
  onPress?: () => void;
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
};

export function CircleIconButton({ sf, onPress, badge, style, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress?.();
      }}
      style={[
        {
          width: 46,
          height: 46,
          borderRadius: radius.pill,
          backgroundColor: 'rgba(255,255,255,0.96)',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: shadow.soft,
          borderCurve: 'continuous',
        },
        style,
      ]}
    >
      <SymbolView name={sf as never} size={20} tintColor={colors.ink as string} />
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

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/tokens';

export function DetailGlyph({
  sf,
  md,
  size = 18,
  color = colors.ink as string,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  size?: number;
  color?: string;
}) {
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={sf as never} size={size} tintColor={color} />
  ) : (
    <MaterialIcons name={md} size={size} color={color} />
  );
}

/** Rounded icon tile used on the detail rows. */
export function IconTile({
  sf,
  md,
  size = 18,
  color,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  size?: number;
  color?: string;
}) {
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        backgroundColor: colors.canvas,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <DetailGlyph sf={sf} md={md} size={size} color={color ?? (colors.ink as string)} />
    </View>
  );
}

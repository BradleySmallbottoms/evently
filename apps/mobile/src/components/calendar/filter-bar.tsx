import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  title: string;
  detail: string;
  active: boolean;
  onPress: () => void;
};

function Sliders() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'slider.horizontal.3' as never} size={16} tintColor={colors.primary} />;
  }
  return <MaterialIcons name="tune" size={18} color={colors.primary} />;
}

function Chevron() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'chevron.right' as never} size={14} tintColor={colors.accent} />;
  }
  return <MaterialIcons name="chevron-right" size={20} color={colors.accent} />;
}

/** Peach summary of the active calendar filters. Opens the filter sheet. */
export function CalendarFilterBar({ title, detail, active, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: active ? colors.accentSoft : colors.card,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.line,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Sliders />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" style={{ color: colors.ink, fontSize: 15 }}>
          {title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <Chevron />
    </Pressable>
  );
}

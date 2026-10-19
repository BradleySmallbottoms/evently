import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export type QuickDateId = 'today' | 'tomorrow' | 'weekend' | 'custom';

type Chip = {
  id: QuickDateId;
  title: string;
  detail?: string;
  icon?: boolean;
};

type Props = {
  chips: Chip[];
  selected: QuickDateId | null;
  onSelect: (id: QuickDateId) => void;
};

function CalendarIcon({ size, active }: { size: number; active: boolean }) {
  const color = active ? colors.accentDeep : colors.accent;
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'calendar' as never} size={size} tintColor={color} />;
  }
  return <MaterialIcons name="calendar-today" size={size} color={color} />;
}


export function QuickDates({ chips, selected, onSelect }: Props) {
  const calendarActive = selected === 'custom';
  return (
    <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        {chips.map((chip) => {
          const active = chip.id === selected;
          return (
            <Pressable
              key={chip.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(chip.id)}
              style={{
                minWidth: 0,
                justifyContent: 'center',
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderCurve: 'continuous',
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.line,
                backgroundColor: active ? colors.accentSoft : colors.card,
                gap: 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                {chip.icon ? <CalendarIcon size={24} active={active} /> : null}
                <AppText
                  variant="label"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{ color: colors.ink, flexShrink: 1, fontSize: 12, lineHeight: 16 }}
                >
                  {chip.title}
                </AppText>
              </View>
              {chip.detail ? (
                <AppText
                  variant="caption"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={{ fontSize: 10, lineHeight: 14 }}
                >
                  {chip.detail}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: calendarActive }}
        onPress={() => onSelect('custom')}
        style={{
          justifyContent: 'center',
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: calendarActive ? colors.accent : colors.line,
          backgroundColor: calendarActive ? colors.accentSoft : colors.card,
          gap: 1,
          minHeight: 44,
          minWidth: 44,
        }}
      >
        <CalendarIcon size={24} active={calendarActive} />
      </Pressable>
    </View>
  );
}

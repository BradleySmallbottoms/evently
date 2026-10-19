import { MenuView } from '@expo/ui/community/menu';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { addMonths, formatMonthChip } from '@/lib/calendar-range';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  year: number;
  month: number;
  locale: string;
  yearLabel: string;
  onYear: (year: number) => void;
  onMonth: (year: number, month: number) => void;
};

function Chevron() {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={'chevron.down' as never} size={12} tintColor={colors.ink} />;
  }
  return <MaterialIcons name="expand-more" size={16} color={colors.ink} />;
}

export function MonthStrip({ year, month, locale, yearLabel, onYear, onMonth }: Props) {
  const months = Array.from({ length: 8 }, (_, index) => addMonths(year, month, index - 2));
  const years = [year - 1, year, year + 1, year + 2];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <MenuView
        actions={years.map((value) => ({
          id: String(value),
          title: String(value),
          state: value === year ? 'on' : 'off',
        }))}
        onPressAction={({ nativeEvent }) => onYear(Number(nativeEvent.event))}
      >
        <View
          accessibilityRole="button"
          accessibilityLabel={`${yearLabel}, ${year}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: space.sm }}
        >
          <AppText variant="subtitle" style={{ fontSize: 16 }}>
            {year}
          </AppText>
          <Chevron />
        </View>
      </MenuView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.xs, alignItems: 'center' }}
        style={{ flex: 1 }}
      >
        {months.map((item) => {
          const selected = item.y === year && item.m === month;
          return (
            <Pressable
              key={`${item.y}-${item.m}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onMonth(item.y, item.m)}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.pill,
                backgroundColor: selected ? colors.accentSoft : 'transparent',
              }}
            >
              <AppText
                variant="label"
                style={{ color: selected ? colors.ink : colors.inkMuted, fontSize: 15 }}
              >
                {formatMonthChip(item.y, item.m, locale, year)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

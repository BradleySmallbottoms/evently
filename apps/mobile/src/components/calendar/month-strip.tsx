import { MenuView } from '@expo/ui/community/menu';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { addMonths, capitalize, ZONE, zonedDate } from '@/lib/calendar-range';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Month = { y: number; m: number };

type Props = {
  year: number;
  month: number;
  /** Months before this one are left out. */
  earliest: Month;
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

function monthOrder(value: Month) {
  return value.y * 12 + value.m;
}


export function formatMonthChip(
  year: number,
  month: number,
  locale: string,
  selectedYear: number,
  selected: boolean,
): React.ReactNode {
  const text = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: ZONE })
    .format(zonedDate({ y: year, m: month, d: 1 }, false))
    .replace('.', '');
  const label = capitalize(text);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <AppText
        variant="label"
        style={{ color: selected ? colors.accentDeep : colors.ink, fontSize: 14 }
        }
      >
        {label}
      </AppText>
      {year !== selectedYear && (<AppText
        variant="caption"
        style={{ color: selected ? colors.ink : colors.inkMuted, fontSize: 10 }
        }
      >
        {year}
      </AppText>
      )}
    </View>
  )
}

export function MonthStrip({ year, month, earliest, locale, yearLabel, onYear, onMonth }: Props) {
  const backed = addMonths(year, month, -2);
  const start = monthOrder(backed) < monthOrder(earliest) ? earliest : backed;
  const months = Array.from({ length: 12 }, (_, index) => addMonths(start.y, start.m, index));
  const firstYear = Math.max(year - 1, earliest.y);
  const years = Array.from({ length: 4 }, (_, index) => firstYear + index);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <MenuView
        style={{ backgroundColor: colors.card, borderRadius: radius.sm }}
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
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: space.lg, paddingHorizontal: space.md }}
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
        contentContainerStyle={{ gap: space.sm, alignItems: 'center' }}
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
                borderRadius: radius.sm,
                backgroundColor: selected ? colors.accent : colors.card,
              }}
            >
              {formatMonthChip(item.y, item.m, locale, year, selected)}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

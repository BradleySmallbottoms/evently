import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import {
  addMonths,
  compareStamps,
  formatMonthYear,
  monthGrid,
  type DayStamp,
} from '@/lib/calendar-range';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function weekdayLabels(locale: string): string[] {
  const monday = new Date(Date.UTC(2026, 0, 5));
  return WEEKDAYS.map((offset) => {
    const day = new Date(monday);
    day.setUTCDate(5 + offset);
    const label = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
      .format(day)
      .replace('.', '');
    return label.charAt(0).toUpperCase() + label.slice(1, 2);
  });
}

export function TipDatePicker({
  value,
  disabled,
  locale,
  onChange,
}: {
  value: DayStamp;
  disabled: boolean;
  locale: string;
  onChange: (day: DayStamp) => void;
}) {
  const [cursor, setCursor] = useState({ y: value.y, m: value.m });
  const labels = weekdayLabels(locale);
  const cells = monthGrid(cursor.y, cursor.m);

  return (
    <View
      pointerEvents={disabled ? 'none' : 'auto'}
      style={{
        opacity: disabled ? 0.55 : 1,
        gap: space.lg,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <MonthStep onPress={() => setCursor((current) => addMonths(current.y, current.m, -1))} />
        <AppText variant="label">{formatMonthYear(cursor.y, cursor.m, locale)}</AppText>
        <MonthStep
          forward
          onPress={() => setCursor((current) => addMonths(current.y, current.m, 1))}
        />
      </View>
      <View style={{ flexDirection: 'row', paddingTop: space.sm }}>
        {labels.map((label, index) => (
          <AppText
            key={index}
            variant="caption"
            style={{ flex: 1, textAlign: 'center', color: colors.inkMuted }}
          >
            {label}
          </AppText>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day) => {
          const selected = compareStamps(day, value) === 0;
          const outside = day.m !== cursor.m;
          return (
            <Pressable
              key={`${day.y}-${day.m}-${day.d}`}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(day)}
              style={{
                width: `${100 / 7}%`,
                height: 46,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: '86%',
                  maxWidth: 40,
                  aspectRatio: 1,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? colors.accent : 'transparent',
                }}
              >
                <AppText
                  variant="body"
                  style={{
                    fontWeight: selected ? '700' : '400',
                    color: selected ? colors.primary : outside ? colors.inkMuted : colors.ink,
                  }}
                >
                  {day.d}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function MonthStep({ forward = false, onPress }: { forward?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.canvas,
      }}
    >
      <AppText variant="label" style={{ color: colors.ink }}>
        {forward ? '›' : '‹'}
      </AppText>
    </Pressable>
  );
}

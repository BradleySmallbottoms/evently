import { BottomSheet, Host } from '@expo/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import {
  addMonths,
  boundsIso,
  compareStamps,
  formatDayLong,
  formatDayShort,
  formatMonthYear,
  formatRangeShort,
  monthGrid,
  monthStamps,
  partsInZone,
  spans,
  stampKey,
  type DayStamp,
} from '@/lib/calendar-range';
import { listPublicEvents, type EventQueryPoint } from '@/lib/events';
import { shownWhen } from '@/lib/span-occasions';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Range = { from: DayStamp; to: DayStamp };
type Mode = 'day' | 'range';

type Props = {
  isPresented: boolean;
  locale: string;
  point?: EventQueryPoint;
  tagIds: string[];
  price?: 'free' | 'paid';
  initial: Range | null;
  onDismiss: () => void;
  onApply: (range: Range) => void;
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function weekdayLabels(locale: string): string[] {
  const monday = new Date(Date.UTC(2026, 0, 5));
  return WEEKDAYS.map((offset) => {
    const day = new Date(monday);
    day.setUTCDate(5 + offset);
    const label = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(day);
    const clean = label.replace('.', '');
    return clean.charAt(0).toUpperCase() + clean.slice(1, 3);
  });
}

export function CalendarDateSheet({
  isPresented,
  locale,
  point,
  tagIds,
  price,
  initial,
  onDismiss,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const contentWidth = width - space.xl * 2;
  const today = partsInZone(new Date());
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('day');
  const [cursor, setCursor] = useState(() => {
    const today = partsInZone(new Date());
    return { y: today.y, m: today.m };
  });
  const [from, setFrom] = useState<DayStamp | null>(null);
  const [to, setTo] = useState<DayStamp | null>(null);

  if (isPresented !== open) {
    setOpen(isPresented);
    if (isPresented) {
      const today = partsInZone(new Date());
      const start = initial?.from ?? today;
      setCursor({ y: start.y, m: start.m });
      setFrom(initial?.from ?? null);
      setTo(initial?.to ?? null);
      setMode(initial && compareStamps(initial.from, initial.to) !== 0 ? 'range' : 'day');
    }
  }

  const month = monthStamps(cursor.y, cursor.m);
  const coverFrom = from && compareStamps(from, month.from) < 0 ? from : month.from;
  const coverTo = to && compareStamps(to, month.to) > 0 ? to : month.to;
  const iso = boundsIso(coverFrom, coverTo);
  const dots = useQuery({
    queryKey: ['calendar-dots', point, iso.from, iso.to, tagIds.join('\n'), price],
    enabled: isPresented && point != null,
    queryFn: () =>
      listPublicEvents(point!, {
        from: iso.from,
        to: iso.to,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        price,
        sort: 'soonest',
        limit: 100,
      }),
  });
  const marked = new Set(
    (dots.data?.items ?? []).map((event) =>
      stampKey(partsInZone(new Date(shownWhen(event, new Date()).startsAt), event.timezone)),
    ),
  );
  const cells = monthGrid(cursor.y, cursor.m);
  const cellSize = Math.floor(contentWidth / 7);
  const ready = mode === 'day' ? from != null : from != null && to != null;
  const applied = !ready || from == null ? null : { from, to: mode === 'day' || to == null ? from : to };
  const showLabel =
    applied == null
      ? t('events.calendar.pickTitle')
      : t('events.calendar.showDate', {
          date:
            compareStamps(applied.from, applied.to) === 0
              ? formatDayLong(applied.from, locale)
              : formatRangeShort(applied.from, applied.to, locale),
        });
  const matchCount = applied
    ? (dots.data?.items ?? []).filter((event) =>
        spans(
          partsInZone(new Date(shownWhen(event, new Date()).startsAt), event.timezone),
          applied.from,
          applied.to,
        ),
      ).length
    : 0;

  function pick(day: DayStamp) {
    if (compareStamps(day, today) < 0) return;
    if (day.m !== cursor.m || day.y !== cursor.y) setCursor({ y: day.y, m: day.m });
    if (mode === 'day') {
      setFrom(day);
      setTo(day);
      return;
    }
    if (!from || (from && to)) {
      setFrom(day);
      setTo(null);
      return;
    }
    if (compareStamps(day, from) < 0) {
      setTo(from);
      setFrom(day);
      return;
    }
    setTo(day);
  }

  function shiftMonth(delta: number) {
    setCursor(addMonths(cursor.y, cursor.m, delta));
  }

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.78 }]}
        containerColor={colors.card}
        contentPadding={{ top: space.lg, bottom: space.lg, left: space.xl, right: space.xl }}
      >
        <SheetBody fill>
          <View style={{ width: contentWidth, flex: 1, gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable accessibilityRole="button" onPress={onDismiss} hitSlop={8}>
                <AppText variant="label" style={{ color: colors.inkMuted }}>
                  {t('events.calendar.cancel')}
                </AppText>
              </Pressable>
              <AppText variant="subtitle">{t('events.calendar.pickTitle')}</AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFrom(null);
                  setTo(null);
                }}
                hitSlop={8}
              >
                <AppText variant="label" style={{ color: colors.accent }}>
                  {t('events.calendar.clear')}
                </AppText>
              </Pressable>
            </View>

            <View
              style={{
                flexDirection: 'row',
                backgroundColor: colors.canvas,
                borderRadius: radius.pill,
                padding: 4,
              }}
            >
              {(['day', 'range'] as const).map((value) => {
                const selected = mode === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setMode(value);
                      if (value === 'day' && from) setTo(from);
                    }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: space.sm,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? colors.accent : 'transparent',
                    }}
                  >
                    <AppText variant="label" style={{ color: selected ? colors.primary : colors.ink }}>
                      {value === 'day' ? t('events.calendar.oneDay') : t('events.calendar.range')}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {mode === 'range' ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <DateField
                  label={t('events.calendar.from')}
                  value={from ? formatDayShort(from, locale) : '–'}
                  onClear={() => setFrom(null)}
                  clearLabel={t('events.calendar.clear')}
                />
                <DateField
                  label={t('events.calendar.to')}
                  value={to ? formatDayShort(to, locale) : '–'}
                  onClear={() => setTo(null)}
                  clearLabel={t('events.calendar.clear')}
                />
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} hitSlop={8}>
                <AppText variant="subtitle">‹</AppText>
              </Pressable>
              <AppText variant="subtitle">{formatMonthYear(cursor.y, cursor.m, locale)}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shiftMonth(1)} hitSlop={8}>
                <AppText variant="subtitle">›</AppText>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row' }}>
              {weekdayLabels(locale).map((label) => (
                <View key={label} style={{ width: cellSize, alignItems: 'center' }}>
                  <AppText variant="caption">{label}</AppText>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((day) => {
                const outside = day.m !== cursor.m;
                const past = compareStamps(day, today) < 0;
                const start = from != null && compareStamps(day, from) === 0;
                const end = to != null && compareStamps(day, to) === 0;
                const inside =
                  mode === 'range' && from != null && to != null && spans(day, from, to);
                const chosen = mode === 'day' ? start : start || end;
                return (
                  <Pressable
                    key={stampKey(day)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen, disabled: past }}
                    disabled={past}
                    onPress={() => pick(day)}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: inside && !chosen ? colors.accentSoft : 'transparent',
                      borderRadius: chosen ? cellSize / 2 : 0,
                    }}
                  >
                    <View
                      style={{
                        width: cellSize - 6,
                        height: cellSize - 6,
                        borderRadius: cellSize,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: chosen ? colors.accent : 'transparent',
                      }}
                    >
                      <AppText
                        variant="label"
                        style={{
                          color: chosen
                            ? colors.primary
                            : past || outside
                              ? colors.inkMuted
                              : colors.ink,
                          opacity: past ? 0.4 : 1,
                        }}
                      >
                        {day.d}
                      </AppText>
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          marginTop: 2,
                          backgroundColor: marked.has(stampKey(day))
                            ? chosen
                              ? colors.primary
                              : colors.secondary
                            : 'transparent',
                        }}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ gap: space.sm, alignItems: 'stretch' }}>
              <PrimaryButton
                label={showLabel}
                disabled={!ready}
                onPress={() => {
                  if (!applied) return;
                  onApply(applied);
                }}
              />
              <AppText variant="caption">
                {t('events.calendar.eventCount', { count: matchCount })}
              </AppText>
            </View>
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}

function DateField({
  label,
  value,
  onClear,
  clearLabel,
}: {
  label: string;
  value: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        gap: 2,
      }}
    >
      <AppText variant="caption">{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="label" style={{ color: colors.ink }}>
          {value}
        </AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear} hitSlop={8}>
          <AppText variant="caption">×</AppText>
        </Pressable>
      </View>
    </View>
  );
}

import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { AppText } from '@/components/ui/app-text';
import { nearestTipClock } from '@/lib/tip-clock';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const ITEM = 44;
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, '0'));

function Wheel({
  values,
  selected,
  disabled,
  label,
  onSelect,
}: {
  values: string[];
  selected: string;
  disabled: boolean;
  label: string;
  onSelect: (value: string) => void;
}) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const index = Math.max(0, values.indexOf(selected));
  const [offset, setOffset] = useState(index * ITEM);

  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM, animated: false });
    setOffset(index * ITEM);
  }, [index]);

  function settle(nextOffset: number) {
    const next = Math.min(values.length - 1, Math.max(0, Math.round(nextOffset / ITEM)));
    const value = values[next];
    if (value && value !== selected) onSelect(value);
  }

  return (
    <View
      accessibilityLabel={label}
      style={{
        flex: 1,
        height: ITEM * 3,
        borderRadius: 18,
        backgroundColor: colors.background,
        overflow: 'hidden',
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: ITEM,
          left: 0,
          right: 0,
          height: ITEM,
          borderRadius: 14,
          backgroundColor: colors.accentSoft,
        }}
      />
      <ScrollView
        ref={ref}
        scrollEnabled={!disabled}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: ITEM }}
        onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(event) => {
          if (Math.abs(event.nativeEvent.velocity?.y ?? 0) > 0.05) return;
          settle(event.nativeEvent.contentOffset.y);
        }}
      >
        {values.map((value, itemIndex) => {
          const distance = Math.abs(itemIndex * ITEM - offset) / ITEM;
          const active = distance < 0.45;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onSelect(value)}
              style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppText
                style={{
                  fontSize: active ? 22 : 16,
                  fontWeight: active ? '700' : '500',
                  color: active ? colors.ink : colors.inkMuted,
                  opacity: active ? 1 : 0.4,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {value}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function TipTimePicker({
  value,
  disabled,
  hourLabel,
  minuteLabel,
  onChange,
  option,
}: {
  value: string;
  disabled: boolean;
  hourLabel: string;
  minuteLabel: string;
  onChange: (clock: string) => void;
  option?: { label: string; selected: boolean; onPress: () => void } | null;
}) {
  const clock = nearestTipClock(value);
  const [hour, minute] = clock.split(':') as [string, string];

  function choose(nextHour: string, nextMinute: string) {
    const next = `${nextHour}:${nextMinute}`;
    if (next === clock) return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    onChange(next);
  }

  return (
    <View
      pointerEvents={disabled ? 'none' : 'auto'}
      style={{
        opacity: disabled ? 0.55 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: 24,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        gap: space.lg,
      }}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Wheel
          values={HOURS}
          selected={hour}
          disabled={disabled}
          label={hourLabel}
          onSelect={(next) => choose(next, minute)}
        />
        <AppText variant="subtitle" style={{ color: colors.ink }}>
          :
        </AppText>
        <Wheel
          values={MINUTES}
          selected={minute}
          disabled={disabled}
          label={minuteLabel}
          onSelect={(next) => choose(hour, next)}
        />
      </View>
      {option ? (
        <View
          style={{
            width: 1,
            alignSelf: 'stretch',
            marginVertical: space.md,
            backgroundColor: colors.line,
          }}
        />
      ) : null}
      {option ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: option.selected, disabled }}
          disabled={disabled}
          onPress={option.onPress}
          style={{
            borderWidth: 1,
            borderColor: option.selected ? colors.accent : colors.line,
            borderRadius: radius.pill,
            backgroundColor: option.selected ? colors.accent : colors.card,
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2,
          }}
        >
          <AppText variant="label" style={{ color: colors.ink, textAlign: 'center' }}>
            {option.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

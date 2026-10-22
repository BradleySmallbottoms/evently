import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { Tip } from '@local-events/contracts';

import { AppText } from '@/components/ui/app-text';
import { foundTipClock, foundTipDay } from '@/lib/tip-clock';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';

type AskKey = NonNullable<Tip['messages'][number]['key']>;

const FACTS = [
  'title',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'place',
  'price',
  'link',
  'description',
] as const;
type Fact = (typeof FACTS)[number];

export function CollectedCard({
  askKey,
  done,
  total,
  title,
  startsAt,
  place,
  priceLabel,
  photoUri,
  locale,
  working,
}: {
  askKey: AskKey | null;
  done: number;
  total: number;
  title: string | null;
  startsAt: string | null;
  place: string | null;
  priceLabel: string | null;
  photoUri: string | null;
  locale: string;
  working: boolean;
}) {
  const { t } = useTranslation();
  const when = formatWhen(startsAt, locale);
  const firstLoad = !title?.trim() && !when && !place?.trim() && !priceLabel?.trim();
  return (
    <View style={{ position: 'relative' }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 24,
          padding: space.md,
          gap: space.md,
          boxShadow: shadow.hard,
          zIndex: 1,
        }}
      >
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              overflow: 'hidden',
              backgroundColor: colors.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : firstLoad ? (
              <SkeletonBlock width={72} height={72} radius={16} />
            ) : (
              <MaterialIcons name="image" size={22} color={colors.inkMuted} />
            )}
            {working && !photoUri ? (
              <ActivityIndicator style={{ position: 'absolute' }} color={colors.accent} />
            ) : null}
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            {firstLoad ? (
              <SkeletonBlock width="78%" height={22} />
            ) : (
              <AppText
                numberOfLines={2}
                style={{ fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.ink }}
              >
                {title?.trim() || '—'}
              </AppText>
            )}
            {firstLoad ? (
              <SkeletonBlock
                width="46%"
                height={12}
                style={{ marginTop: space.xs, marginBottom: space.xs }}
              />
            ) : (
              <AppText variant="caption" style={{ color: colors.inkMuted, fontSize: 11 }}>
                {when ?? '—'}
              </AppText>
            )}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: space.sm,
              }}
            >
              {firstLoad ? (
                <SkeletonBlock width="48%" height={22} radius={radius.xs} />
              ) : (
                <FactChip icon="place" label={place?.trim() || '—'} />
              )}
              {firstLoad ? (
                <SkeletonBlock width="48%" height={22} radius={radius.xs} />
              ) : (
                <FactChip icon="confirmation-number" label={priceLabel?.trim() || '—'} />
              )}
            </View>
          </View>
        </View>

        <CardProgress askKey={askKey} done={done} total={total} />
      </View>
      {/* <View style={{ position: 'absolute', bottom: -13.8, left: 0, right: 0, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: '15%', height: 14, backgroundColor: colors.card, borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs, boxShadow: shadow.hard, zIndex: 2 }} >

        </View>
      </View> */}
    </View>
  );
}

function SkeletonBlock({
  width,
  height,
  radius: corner = radius.pill,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: reduced ? 1 : opacity.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      style={[{ width, height, borderRadius: corner, backgroundColor: colors.line }, pulse, style]}
    />
  );
}

function FactChip({
  icon,
  label,
}: {
  icon: 'calendar-today' | 'place' | 'confirmation-number';
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.accentSoft,
        borderRadius: radius.xs,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        maxWidth: '48.7%',
        width: '49%',
      }}
    >
      <MaterialIcons name={icon} size={14} color={colors.accent} />
      <AppText
        numberOfLines={1}
        variant="caption"
        style={{ color: colors.accentDeep, flexShrink: 1, fontSize: 12 }}
      >
        {label}
      </AppText>
    </View>
  );
}

function CardProgress({
  askKey,
  done,
  total,
}: {
  askKey: AskKey | null;
  done: number;
  total: number;
}) {
  const { t } = useTranslation();
  const steps = stepWindow(askKey, done, total);
  const count = Math.max(total, 1);
  const current =
    steps.current === 'image'
      ? count - 1
      : Math.min(FACTS.indexOf(steps.current as Fact), count - 1);
  const fill = count <= 1 ? 0 : current / (count - 1);
  return (
    <View style={{ height: 28, justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          height: 3,
          borderRadius: 2,
          backgroundColor: colors.line,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 6,
          width: `${Math.max(0, Math.min(1, fill)) * 100}%`,
          height: 3,
          borderRadius: 2,
          backgroundColor: colors.accent,
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {Array.from({ length: count }, (_, index) => {
          if (index === current) {
            return (
              <View
                key={index}
                style={{
                  backgroundColor: colors.accent,
                  borderRadius: radius.pill,
                  paddingHorizontal: space.sm + 2,
                  paddingVertical: 4,
                  maxWidth: 120,
                }}
              >
                <AppText
                  numberOfLines={1}
                  variant="caption"
                  style={{ fontSize: 11, fontWeight: '600', color: colors.ink }}
                >
                  {factLabel(steps.current, t)}
                </AppText>
              </View>
            );
          }
          const active = index < current;
          return (
            <View
              key={index}
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: active ? colors.accent : colors.card,
                borderWidth: active ? 0 : 1.5,
                borderColor: colors.line,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function formatWhen(startsAt: string | null, locale: string): string | null {
  const day = foundTipDay(startsAt);
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year!, month! - 1, date));
  const clock = foundTipClock(startsAt);
  return clock ? `${formatted}, ${clock}` : formatted;
}

function stepWindow(
  askKey: AskKey | null,
  done: number,
  total: number,
): { current: Fact | 'image' } {
  if (askKey === 'image' && total > 0 && done >= total) return { current: 'image' };
  const found =
    askKey && askKey !== 'image' && (FACTS as readonly string[]).includes(askKey)
      ? FACTS.indexOf(askKey as Fact)
      : -1;
  const index = found >= 0 ? found : Math.min(Math.max(done, 0), FACTS.length - 1);
  return { current: FACTS[index]! };
}

function factLabel(step: Fact | 'image', t: (key: string) => string): string {
  if (step === 'image') return t('tips.facts.image');
  return t(`tips.facts.${step}`);
}

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { SkeletonBlock } from '@/components/ui/skeleton-block';
import { foundTipClock, foundTipDay } from '@/lib/tip-clock';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';

export function CollectedCard({
  found,
  verified,
  total,
  title,
  startsAt,
  place,
  priceLabel,
  photoUri,
  locale,
  working,
}: {
  found: number;
  verified: number;
  total: number;
  title: string | null;
  startsAt: string | null;
  place: string | null;
  priceLabel: string | null;
  photoUri: string | null;
  locale: string;
  working: boolean;
}) {
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

        <CardProgress found={found} verified={verified} total={total} />
      </View>
      {/* <View style={{ position: 'absolute', bottom: -13.8, left: 0, right: 0, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: '15%', height: 14, backgroundColor: colors.card, borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs, boxShadow: shadow.hard, zIndex: 2 }} >

        </View>
      </View> */}
    </View>
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
  found,
  verified,
  total,
}: {
  found: number;
  verified: number;
  total: number;
}) {
  const { t } = useTranslation();
  const count = Math.max(total, 1);
  const foundCount = Math.max(0, Math.min(found, count));
  const verifiedCount = Math.max(0, Math.min(verified, foundCount));
  const reach = (steps: number) =>
    count <= 1 ? (steps > 0 ? 1 : 0) : Math.max(0, steps - 1) / (count - 1);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${t('tips.foundCount', { count: foundCount })}, ${t('tips.verifiedCount', { count: verifiedCount })}`}
      style={{ gap: space.xs }}
    >
      <View style={{ height: 16, justifyContent: 'center' }}>
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
            left: 0,
            width: `${reach(foundCount) * 100}%`,
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.accentSoft,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            width: `${reach(verifiedCount) * 100}%`,
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.accent,
          }}
        />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          {Array.from({ length: count }, (_, index) => {
            const state =
              index < verifiedCount ? 'verified' : index < foundCount ? 'found' : 'missing';
            return (
              <View
                key={index}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor:
                    state === 'verified'
                      ? colors.accent
                      : state === 'found'
                        ? colors.accentSoft
                        : colors.card,
                  borderWidth: state === 'missing' ? 1.5 : 0,
                  borderColor: colors.line,
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function ProgressCount({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <AppText variant="caption" style={{ color: colors.inkMuted, fontSize: 11 }}>
        {label}
      </AppText>
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

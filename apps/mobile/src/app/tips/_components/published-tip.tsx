import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { deviceAssetUrl } from '@local-events/domain';
import type { Tip } from '@local-events/contracts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { API_URL } from '@/lib/api';
import { shareEventLink } from '@/lib/event-share';
import { foundTipClock, foundTipDay } from '@/lib/tip-clock';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

/** Filled button on the thank-you screen. Darker than the peach accent so the white label stays readable. */
const TERRACOTTA = '#C47848';
const TERRACOTTA_LINE = '#E7D4C4';

type ShownEvent = {
  title: string;
  startsAt: string | null;
  venueName: string | null;
  imageUrl: string | null;
  city: string | null;
};

export function PublishedTip({ tip, event }: { tip: Tip; event: ShownEvent | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const title = event?.title || tip.found?.title || tip.card?.title || t('tips.fallbackTitle');
  const when = formatWhen(
    event?.startsAt ?? tip.found?.startsAt ?? tip.card?.startsAt ?? null,
    locale,
  );
  const place = placeLine(
    event?.venueName ?? null,
    event?.city ?? null,
    tip.found?.place ?? tip.card?.place ?? null,
  );
  const imageUrl = previewUri(event?.imageUrl ?? tip.previewImageUrl);
  const eventId = tip.eventId;

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function share() {
    if (!eventId) return;
    void shareEventLink({ title, eventId });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.xl,
          gap: space.lg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('events.back')}
            onPress={goBack}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Glyph sf="chevron.left" md="chevron-left" color={colors.ink} size={26} />
          </Pressable>
          <AppText
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 17,
              lineHeight: 22,
              fontWeight: '700',
              color: colors.ink,
            }}
          >
            {t('tips.yoursTitle')}
          </AppText>
          {eventId ? (
            <CircleIconButton
              plain
              sf="ellipsis"
              md="more-horiz"
              accessibilityLabel={t('tips.share')}
              onPress={share}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        <PaperPlane />

        <View style={{ gap: space.sm, alignItems: 'center', paddingHorizontal: space.md }}>
          <AppText
            style={{
              textAlign: 'center',
              fontSize: 26,
              lineHeight: 32,
              fontWeight: '700',
              color: colors.ink,
            }}
          >
            {t('tips.thanksTitle')}
          </AppText>
          <AppText
            variant="body"
            style={{ textAlign: 'center', color: colors.inkMuted, fontSize: 16, lineHeight: 22 }}
          >
            {t('tips.publishedBody')}
          </AppText>
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            padding: space.md,
            gap: space.md,
            boxShadow: shadow.card,
          }}
        >
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                accessibilityIgnoresInvertColors
                style={{
                  width: 84,
                  height: 108,
                  borderRadius: radius.sm,
                  backgroundColor: colors.accentSoft,
                }}
              />
            ) : (
              <View
                style={{
                  width: 84,
                  height: 108,
                  borderRadius: radius.sm,
                  borderCurve: 'continuous',
                  backgroundColor: colors.accentSoft,
                }}
              />
            )}
            <View style={{ flex: 1, gap: space.sm, paddingTop: 2 }}>
              <View
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: colors.secondarySoft,
                  borderRadius: radius.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                }}
              >
                <Glyph
                  sf="checkmark.circle.fill"
                  md="check-circle"
                  color={colors.success}
                  size={14}
                />
                <AppText
                  style={{ color: colors.success, fontSize: 13, lineHeight: 16, fontWeight: '600' }}
                >
                  {t('tips.publishedBadge')}
                </AppText>
              </View>
              <AppText
                style={{ fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.ink }}
                numberOfLines={3}
              >
                {title}
              </AppText>
              {when ? <MetaRow sf="calendar" md="event" label={when} /> : null}
              {place ? <MetaRow sf="mappin" md="location-on" label={place} /> : null}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <ActionButton
              label={t('tips.viewEvent')}
              sf="arrow.up.right.square"
              md="open-in-new"
              filled
              iconEnd
              disabled={!eventId}
              onPress={() => {
                if (eventId) router.push(`/events/${eventId}`);
              }}
            />
            <ActionButton
              label={t('tips.share')}
              sf="square.and.arrow.up"
              md="share"
              disabled={!eventId}
              onPress={share}
            />
            <ActionButton
              label={t('tips.seeYours')}
              sf="list.bullet"
              md="format-list-bulleted"
              onPress={() => router.push('/profile/tips')}
            />
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: space.md,
            backgroundColor: '#FBF6F1',
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            padding: space.lg,
          }}
        >
          <Glyph sf="heart.fill" md="favorite" color={colors.danger} size={22} />
          <View style={{ flex: 1, gap: 4 }}>
            <AppText style={{ fontSize: 16, lineHeight: 21, fontWeight: '700', color: colors.ink }}>
              {t('tips.thanksNote')}
            </AppText>
            <AppText
              variant="body"
              style={{ color: colors.inkMuted, fontSize: 15, lineHeight: 21 }}
            >
              {t('tips.thanksBody')}
            </AppText>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function MetaRow({
  sf,
  md,
  label,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Glyph sf={sf} md={md} color={colors.inkMuted} size={15} />
      <AppText
        style={{ flex: 1, color: colors.inkMuted, fontSize: 14, lineHeight: 18 }}
        numberOfLines={2}
      >
        {label}
      </AppText>
    </View>
  );
}

function ActionButton({
  label,
  sf,
  md,
  filled,
  iconEnd,
  disabled,
  onPress,
}: {
  label: string;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  filled?: boolean;
  iconEnd?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = filled ? '#FFFFFF' : TERRACOTTA;
  const icon = <Glyph sf={sf} md={md} color={color} size={18} />;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 52,
        borderRadius: radius.xl,
        borderCurve: 'continuous',
        backgroundColor: filled ? TERRACOTTA : colors.card,
        borderWidth: filled ? 0 : 1.5,
        borderColor: TERRACOTTA_LINE,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      {iconEnd ? null : icon}
      <AppText style={{ color, fontSize: 16, lineHeight: 20, fontWeight: '600' }}>{label}</AppText>
      {iconEnd ? icon : null}
    </Pressable>
  );
}

function Glyph({
  sf,
  md,
  color,
  size,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  color: string;
  size: number;
}) {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={sf as never} size={size} tintColor={color} />;
  }
  return <MaterialIcons name={md} size={size} color={color} />;
}

function PaperPlane() {
  return (
    <View style={{ height: 132, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={176} height={132} viewBox="0 0 176 132">
        <Path d={sparkle(34, 42, 8)} fill="#F0C27A" />
        <Path d={sparkle(52, 86, 5)} fill="#E8B56A" />
        <Path d={sparkle(138, 24, 7)} fill="#F0C27A" />
        <Path d={sparkle(156, 58, 4)} fill="#E8B56A" />
        <Path d="M42 84 L138 36 L90 102 Z" fill="#F6C98A" />
        <Path d="M90 102 L114 64 L138 36 Z" fill="#E7A15C" />
        <Path d="M90 102 L76 118 L114 64 Z" fill="#D08A4C" />
        <Path d="M72 74 L114 64 L90 102 Z" fill="#F3B56A" />
        <Circle cx="132" cy="98" r="16" fill={colors.success} />
        <Path
          d="M124 98.5 L129.5 104 L141 91"
          stroke="#FFFFFF"
          strokeWidth={2.6}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function sparkle(cx: number, cy: number, r: number): string {
  const inner = r * 0.28;
  return `M ${cx} ${cy - r} L ${cx + inner} ${cy - inner} L ${cx + r} ${cy} L ${cx + inner} ${cy + inner} L ${cx} ${cy + r} L ${cx - inner} ${cy + inner} L ${cx - r} ${cy} L ${cx - inner} ${cy - inner} Z`;
}

function previewUri(url: string | null): string | null {
  if (!url) return null;
  if (Platform.OS === 'web') return url;
  return deviceAssetUrl(url, API_URL);
}

function formatWhen(value: string | null, locale: string): string | null {
  const day = foundTipDay(value);
  if (!day) return null;
  const [year, monthIndex, date] = day.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date(year!, monthIndex! - 1, date))
    .replace(/\./g, '');
  const label = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  const clock = foundTipClock(value);
  return clock ? `${label}, ${clock}` : label;
}

function placeLine(
  venue: string | null,
  city: string | null,
  fallback: string | null,
): string | null {
  const name = venue?.trim() || null;
  const town = city?.trim() || null;
  if (name && town && !name.toLowerCase().includes(town.toLowerCase())) return `${name}, ${town}`;
  return name || fallback?.trim() || null;
}

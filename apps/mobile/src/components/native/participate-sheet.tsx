import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { PrimaryButton, type ButtonIcon } from '@/components/ui/primary-button';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';
import { t } from 'i18next';

/**
 * Short-stop height above the home inset. The bar draws that inset itself,
 * so the visible height is this plus the inset.
 */
export const PARTICIPATE_PEEK_DETENT = 88;

const HANDLE = 20;

/** Visible height of the short stop, used to keep page content above the sheet. */
export function participatePeekHeight(bottomInset: number) {
  return PARTICIPATE_PEEK_DETENT + bottomInset;
}

const SPRING = { damping: 26, stiffness: 280, mass: 0.6 };

export type ParticipateSheetLink = {
  key: string;
  url: string;
  title: string;
  detail: string;
};

export type ParticipateBarAction = {
  key: string;
  label: string;
  onPress: () => void;
  sf?: string;
  md?: keyof typeof MaterialIcons.glyphMap;
  letter?: string;
};

export function ParticipateSheet({
  title,
  when,
  imageUrl,
  eventId,
  tags,
  actionLabel,
  actionIcon,
  actionDetail,
  onAction,
  eventLinks,
  shares,
  reportLabel,
  onReport,
  paused = false,
}: {
  title: string;
  when: string;
  imageUrl?: string | null;
  eventId?: string | null;
  tags?: string[];
  actionLabel: string;
  actionIcon: ButtonIcon;
  /** Shown inside the action button, such as a ticket price. */
  actionDetail?: string | null;
  onAction: () => void;
  eventLinks: ParticipateSheetLink[];
  shares: ParticipateBarAction[];
  reportLabel: string;
  onReport: () => void;
  /** Another dialog is open, so this bar should not take touches. */
  paused?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [linksHeight, setLinksHeight] = useState(0);
  const [open, setOpen] = useState(false);
  const collapsed = participatePeekHeight(insets.bottom);
  const span = Math.max(0, Math.min(linksHeight, Math.round(windowHeight * 0.75) - collapsed));
  const collapsedSv = useSharedValue(collapsed);
  const spanSv = useSharedValue(span);
  const reducedSv = useSharedValue(reduced === true);
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  collapsedSv.value = collapsed;
  spanSv.value = span;
  reducedSv.value = reduced === true;

  function markOpen(next: boolean) {
    setOpen(next);
  }

  function settle(next: boolean) {
    const to = next ? 1 : 0;
    offset.value = reduced ? withTiming(to, { duration: 160 }) : withSpring(to, SPRING);
    markOpen(next);
  }

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!paused)
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .onStart(() => {
          // Shared values are written from the gesture worklet.
          // eslint-disable-next-line react-hooks/immutability -- reanimated shared value
          dragStart.value = offset.value;
        })
        .onUpdate((e) => {
          const range = spanSv.value;
          if (range < 1) return;
          const next = dragStart.value - e.translationY / range;
          // eslint-disable-next-line react-hooks/immutability -- reanimated shared value
          offset.value = Math.min(1, Math.max(0, next));
        })
        .onEnd((e) => {
          const range = Math.max(spanSv.value, 1);
          const projected = offset.value - e.velocityY / range / 2;
          const next = projected > 0.5;
          // eslint-disable-next-line react-hooks/immutability -- reanimated shared value
          offset.value = reducedSv.value
            ? withTiming(next ? 1 : 0, { duration: 160 })
            : withSpring(next ? 1 : 0, SPRING);
          runOnJS(markOpen)(next);
        }),
    [dragStart, offset, paused, reducedSv, spanSv],
  );

  const heightStyle = useAnimatedStyle(() => ({
    height: collapsedSv.value + spanSv.value * offset.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        pointerEvents={paused ? 'none' : 'auto'}
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            backgroundColor: colors.card,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            boxShadow: shadow.hardTop,
            overflow: 'hidden',
          },
          heightStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? t('events.detail.sheetClose') : t('events.detail.sheetOpen')}
          accessibilityState={{ expanded: open }}
          onPress={() => settle(!open)}
          style={{
            height: HANDLE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: colors.line,
            }}
          />
        </Pressable>
        <View style={{ flex: 1, overflow: 'hidden', justifyContent: 'flex-end' }}>
          <View
            pointerEvents={open ? 'auto' : 'none'}
            onLayout={(e) => {
              const next = Math.ceil(e.nativeEvent.layout.height);
              setLinksHeight((current) => (current === next ? current : next));
            }}
            style={{ paddingTop: space.xs }}
          >
            <View style={{ gap: space.md, paddingBottom: space.md, paddingHorizontal: space.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
                <View style={{ flex: 1 }}>
                  {shares.length > 0 ? <ShareActions links={eventLinks} actions={shares} /> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={reportLabel}
                  onPress={onReport}
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Glyph sf="flag" md="flag" size={20} color={colors.inkMuted as string} />
                </Pressable>
              </View>
              <View style={{ height: 1, backgroundColor: colors.line }} />
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              height: PARTICIPATE_PEEK_DETENT - HANDLE,
              paddingHorizontal: space.lg,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: radius.sm,
                overflow: 'hidden',
                backgroundColor: colors.accentSoft,
              }}
            >
              <EventImage imageUrl={imageUrl} tags={tags} eventId={eventId} />
            </View>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <AppText
                numberOfLines={1}
                style={{ fontSize: 14, lineHeight: 18, fontWeight: '700' }}
              >
                {title}
              </AppText>
              <AppText variant="caption" numberOfLines={1}>
                {when}
              </AppText>
            </View>
            <PrimaryButton
              label={actionLabel}
              detail={actionDetail}
              onPress={onAction}
              icon={actionIcon}
              style={{ paddingHorizontal: space.md }}
            />
          </View>
        </View>
        <View style={{ height: insets.bottom }} />
      </Animated.View>
    </GestureDetector>
  );
}

function ShareActions({
  links,
  actions,
}: {
  links: ParticipateSheetLink[];
  actions: ParticipateBarAction[];
}) {
  function openLink(url: string) {
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    void Linking.openURL(url);
  }
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {links.slice(0, 1).map((link) => (
        <Pressable
          key={link.key}
          accessibilityRole="button"
          accessibilityLabel={link.title}
          onPress={() => openLink(link.url)}
          style={{ flex: 1, alignItems: 'center', gap: space.xs, minHeight: 44 }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              backgroundColor: colors.canvas,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Glyph sf="safari" md="link" size={20} color={colors.ink as string} />
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {t('events.detail.homePage')}
          </AppText>
        </Pressable>
      ))}
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{ flex: 1, alignItems: 'center', gap: space.xs, minHeight: 44 }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              backgroundColor: colors.canvas,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {action.letter ? (
              <AppText style={{ fontSize: 18, lineHeight: 22, fontWeight: '700' }}>
                {action.letter}
              </AppText>
            ) : (
              <Glyph
                sf={action.sf ?? 'square.and.arrow.up'}
                md={action.md ?? 'share'}
                size={20}
                color={colors.ink as string}
              />
            )}
          </View>
          <AppText variant="caption" numberOfLines={1}>
            {action.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

function LinkRow({
  link,
  sf,
  md,
  onPress,
}: {
  link: ParticipateSheetLink;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={link.detail ? `${link.title}, ${link.detail}` : link.title}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 44,
      }}
    >
      <Glyph sf={sf} md={md} size={20} color={colors.ink as string} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '700' }}>
          {link.title}
        </AppText>
        {link.detail ? (
          <AppText variant="caption" numberOfLines={1} style={{ color: colors.info }}>
            {link.detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function Glyph({
  sf,
  md,
  size,
  color,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  size: number;
  color: string;
}) {
  return Platform.OS === 'ios' ? (
    <SymbolView name={sf as never} size={size} tintColor={color} />
  ) : (
    <MaterialIcons name={md} size={size} color={color} />
  );
}

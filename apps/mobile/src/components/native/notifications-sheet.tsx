import { BottomSheet, Host } from '@expo/ui';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NotificationItem } from '@local-events/contracts';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { SheetBody } from '@/components/native/sheet-body';
import { AppText } from '@/components/ui/app-text';
import { useAppearance } from '@/lib/appearance-context';
import {
  groupNotifications,
  notificationPresentation,
  notificationText,
  notificationWhen,
  type NotificationGroupId,
  type NotificationPresentation,
  type NotificationWhen,
} from '@/lib/notification-sheet';
import { colors, palette, type CategoryId } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  loading: boolean;
  items: NotificationItem[];
  unreadCount: number;
  actionError: boolean;
  onOpen: (item: NotificationItem) => void;
  onMarkRead: (id: string, read: boolean) => void;
  onMarkAllRead: () => void;
  onDelete: (id: string) => void;
};

const ACTION_WIDTH = 76;

export function NotificationsSheet({
  isPresented,
  onDismiss,
  loading,
  items,
  unreadCount,
  actionError,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const { height, width } = useWindowDimensions();
  const contentWidth = width - space.xl * 2;
  // The sheet already starts below the status bar. Subtract only its own padding.
  const bodyHeight = Math.round(height * 0.9) - space.xxxl - space.md;
  const groups = groupNotifications(items);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={[{ fraction: 0.9 }]}
        containerColor={colors.canvas}
        contentPadding={{ top: space.xxxl, bottom: space.md, left: space.xl, right: space.xl }}
      >
        <SheetBody fill>
          <View style={{ width: contentWidth, height: bodyHeight, gap: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="title">{t('events.notificationsSheetTitle')}</AppText>
                {unreadCount > 0 ? (
                  <AppText variant="caption">
                    {t('events.notificationsUnread', { count: unreadCount })}
                  </AppText>
                ) : null}
              </View>
              {unreadCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('events.notificationMarkAllRead')}
                  hitSlop={8}
                  onPress={() => {
                    lightHaptic();
                    onMarkAllRead();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingTop: 6,
                    maxWidth: 150,
                  }}
                >
                  <SheetIcon
                    name="checkmark.circle.fill"
                    md="check-circle"
                    color={colors.accent}
                    size={18}
                  />
                  <AppText
                    variant="label"
                    style={{ color: colors.accent, fontWeight: '700', flexShrink: 1 }}
                  >
                    {t('events.notificationMarkAllRead')}
                  </AppText>
                </Pressable>
              ) : null}
            </View>

            {actionError ? (
              <AppText variant="caption" style={{ color: colors.danger }}>
                {t('events.notificationActionError')}
              </AppText>
            ) : null}

            {loading ? (
              <AppText variant="body" style={{ color: colors.inkMuted }}>
                {t('events.notificationsLoading')}
              </AppText>
            ) : items.length === 0 ? (
              <AppText variant="body" style={{ color: colors.inkMuted }}>
                {t('events.notificationsEmpty')}
              </AppText>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: space.lg, paddingBottom: space.lg }}
                showsVerticalScrollIndicator={false}
              >
                {groups.map((group) => (
                  <View key={group.id} style={{ gap: space.sm }}>
                    <AppText
                      variant="label"
                      style={{
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                        fontSize: 16,
                        lineHeight: 22,
                        fontWeight: '700',
                      }}
                    >
                      {t(groupLabelKey(group.id))}
                    </AppText>
                    {group.items.map((item) => (
                      <NotificationCard
                        key={item.id}
                        item={item}
                        locale={locale}
                        onOpen={() => {
                          if (item.readAt == null) onMarkRead(item.id, true);
                          onOpen(item);
                        }}
                        onToggleRead={() => {
                          lightHaptic();
                          onMarkRead(item.id, item.readAt != null ? false : true);
                        }}
                        onDelete={() => {
                          lightHaptic();
                          onDelete(item.id);
                        }}
                      />
                    ))}
                  </View>
                ))}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space.sm,
                    paddingTop: space.sm,
                  }}
                >
                  <SheetIcon
                    name="info.circle"
                    md="info-outline"
                    color={colors.inkFaint}
                    size={16}
                  />
                  <AppText variant="caption" style={{ color: colors.inkFaint, flexShrink: 1 }}>
                    {t('events.notificationOpenHint')}
                  </AppText>
                </View>
              </ScrollView>
            )}
          </View>
        </SheetBody>
      </BottomSheet>
    </Host>
  );
}

function groupLabelKey(id: NotificationGroupId): string {
  if (id === 'today') return 'events.notificationGroupToday';
  if (id === 'yesterday') return 'events.notificationGroupYesterday';
  return 'events.notificationGroupEarlier';
}

function headlineKey(kind: NotificationPresentation): string {
  switch (kind) {
    case 'tip_published':
      return 'events.notificationHeadlineTipPublished';
    case 'tip_approved':
      return 'events.notificationHeadlineTipApproved';
    case 'tip_needs_input':
      return 'events.notificationHeadlineTipNeedsInput';
    case 'tip_failed':
      return 'events.notificationHeadlineTipFailed';
    case 'new_event':
      return 'events.notificationHeadlineNew';
    case 'event_updated':
      return 'events.notificationHeadlineUpdated';
    case 'broadcast':
      return 'events.notificationHeadlineBroadcast';
  }
}

function reasonKey(reason: string): string {
  switch (reason) {
    case 'publisher':
      return 'events.notificationReasonPublisher';
    case 'event':
      return 'events.notificationReasonEvent';
    case 'broadcast':
      return 'events.notificationReasonBroadcast';
    case 'tip':
      return 'events.notificationReasonTip';
    default:
      return 'events.notificationReasonNearby';
  }
}

function whenLabel(
  when: NotificationWhen,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (when.kind === 'now') return t('events.notificationTimeNow');
  if (when.kind === 'minutes') return t('events.notificationTimeMinutes', { count: when.count });
  if (when.kind === 'today') return t('events.notificationTimeToday', { time: when.time });
  if (when.kind === 'yesterday') return t('events.notificationTimeYesterday', { time: when.time });
  return [when.date, when.time].filter(Boolean).join(', ');
}

function NotificationCard({
  item,
  locale,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  item: NotificationItem;
  locale: 'sv' | 'en';
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { scheme } = useAppearance();
  const swipe = useRef<SwipeableMethods>(null);
  const presentation = notificationPresentation(item);
  const tone = presentationTone(presentation, scheme);
  const copy = notificationText(item, locale);
  const title = copy.title || t(headlineKey(presentation));
  const message = copy.message || t(reasonKey(item.reason));
  const eventName =
    item.eventId && item.eventTitle.trim() && item.eventTitle.trim() !== title.trim()
      ? item.eventTitle
      : '';
  const when = whenLabel(notificationWhen(item.createdAt, locale), t);
  const unread = item.readAt == null;
  const canOpen = Boolean(item.eventId) || item.reason === 'tip';
  const readLabel = unread ? t('events.notificationMarkRead') : t('events.notificationMarkUnread');

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        boxShadow: shadow.soft,
      }}
    >
      <ReanimatedSwipeable
        ref={swipe}
        friction={2}
        overshootRight={false}
        renderRightActions={() => (
          <View style={{ flexDirection: 'row', height: '100%' }}>
            <SwipeButton
              label={readLabel}
              color={unread ? colors.accent : palette.categories.holidays.primary}
              icon={unread ? 'done' : 'mark-email-unread'}
              onPress={() => {
                swipe.current?.close();
                onToggleRead();
              }}
            />
            <SwipeButton
              label={t('lists.delete')}
              color={colors.danger}
              icon="delete"
              onPress={() => {
                swipe.current?.close();
                onDelete();
              }}
            />
          </View>
        )}
      >
        <Pressable
          accessibilityRole={canOpen ? 'button' : 'text'}
          accessibilityLabel={unread ? t('events.notificationUnreadRow', { title }) : title}
          accessibilityHint={canOpen ? t('events.notificationOpenHint') : undefined}
          disabled={!canOpen}
          onPress={onOpen}
          style={{
            position: 'relative',
            backgroundColor: colors.card,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: space.md,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              borderCurve: 'continuous',
              backgroundColor: tone.fill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SheetIcon name={tone.sf} md={tone.md} color={tone.icon} size={28} />
          </View>
          <View style={{ flex: 1, gap: 2, paddingRight: unread ? space.md : 0 }}>
            <AppText style={{ fontSize: 16, lineHeight: 21, fontWeight: '700' }}>{title}</AppText>
            {eventName ? (
              <AppText variant="caption" style={{ color: colors.inkMuted }}>
                {eventName}
              </AppText>
            ) : null}
            <AppText style={{ fontSize: 15, lineHeight: 21, color: colors.ink }}>{message}</AppText>
            {when ? (
              <AppText variant="caption" style={{ color: colors.inkFaint, marginTop: 2 }}>
                {when}
              </AppText>
            ) : null}
          </View>
          {canOpen ? (
            <MaterialIcons
              name="chevron-right"
              size={22}
              color={colors.inkFaint}
              style={{ alignSelf: 'center' }}
            />
          ) : null}
          {unread ? (
            <View
              style={{
                position: 'absolute',
                top: space.md,
                right: space.md,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.accent,
              }}
            />
          ) : null}
        </Pressable>
      </ReanimatedSwipeable>
    </View>
  );
}

function SwipeButton({
  label,
  color,
  icon,
  onPress,
}: {
  label: string;
  color: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: ACTION_WIDTH,
        height: '100%',
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 4,
      }}
    >
      <MaterialIcons name={icon} size={20} color="#FFFFFF" />
      <AppText
        numberOfLines={2}
        style={{
          color: '#FFFFFF',
          fontSize: 11,
          lineHeight: 13,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function presentationTone(
  kind: NotificationPresentation,
  scheme: 'light' | 'dark',
): { fill: string; icon: string; sf: SFSymbol; md: keyof typeof MaterialIcons.glyphMap } {
  const tone = (id: CategoryId, sf: SFSymbol, md: keyof typeof MaterialIcons.glyphMap) => {
    const cat = palette.categories[id];
    return {
      fill: scheme === 'dark' ? cat.dark : cat.light,
      icon: scheme === 'dark' ? cat.light : cat.primary,
      sf,
      md,
    };
  };
  switch (kind) {
    case 'tip_published':
      return tone('music', 'megaphone.fill', 'campaign');
    case 'tip_approved':
      return tone('sports', 'calendar.badge.checkmark', 'event-available');
    case 'tip_needs_input':
      return tone('holidays', 'questionmark.circle', 'help-outline');
    case 'tip_failed':
      return tone('family', 'exclamationmark.triangle', 'warning');
    case 'new_event':
      return tone('culture', 'sparkles', 'auto-awesome');
    case 'event_updated':
      return tone('family', 'calendar', 'event');
    case 'broadcast':
      return tone('other', 'bell.fill', 'notifications');
  }
}

function SheetIcon({
  name,
  md,
  color,
  size,
}: {
  name: SFSymbol;
  md: keyof typeof MaterialIcons.glyphMap;
  color: string;
  size: number;
}) {
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={name} size={size} tintColor={color} />;
  }
  return <MaterialIcons name={md} size={size} color={color} />;
}

function lightHaptic() {
  if (process.env.EXPO_OS !== 'ios') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

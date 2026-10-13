import { krPriceLabel } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';

import { ConfirmAction } from '@/components/native/confirm-action';
import { EventActionsMenu } from '@/components/native/event-actions-menu';
import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { EventImage } from '@/components/ui/event-image';
import { PricePill, TagPills } from '@/components/ui/tag-pills';
import { buildEventWebUrl, shareEventLink } from '@/lib/event-share';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const THUMB = 92;

type Props = {
  title: string;
  where: string;
  tags?: string[];
  imageUrl?: string | null;
  priceAmount?: number | null;
  dateBadge?: { weekday: string; day: string; month: string } | null;
  /** When set, the card shows the overflow menu (share, copy link, report). */
  eventId?: string;
  saved?: boolean;
  onPress: () => void;
  onSavePress?: () => void;
};

export function EventListItem({
  title,
  where,
  tags = [],
  imageUrl,
  priceAmount,
  dateBadge,
  eventId,
  saved,
  onPress,
  onSavePress,
}: Props) {
  const { t } = useTranslation();
  const priceLabel = krPriceLabel(priceAmount);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        padding: space.md,
        boxShadow: shadow.soft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onPress}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}
        >
          <View style={{ width: THUMB, height: THUMB }}>
            <View
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: radius.sm,
                overflow: 'hidden',
                backgroundColor: colors.accentSoft,
              }}
            >
              <EventImage imageUrl={imageUrl} tags={tags} />
            </View>
            {dateBadge ? (
              <View style={{ position: 'absolute', left: 6, bottom: -6, boxShadow: shadow.hard, borderRadius: radius.sm }}>
                <DateBox badge={dateBadge} compact />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 4, paddingTop: 2, minWidth: 0 }}>
            <AppText variant="subtitle" numberOfLines={2} style={{ fontSize: 16, lineHeight: 21 }}>
              {title}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {where}
              </AppText>
              {priceLabel ? <PricePill label={priceLabel} /> : null}
            </View>
            <TagPills tags={tags} limit={2} size="sm" />
          </View>
        </Pressable>
        {onSavePress || eventId ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {onSavePress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saved ? t('events.unfavorite') : t('events.favorite')}
                onPress={onSavePress}
                hitSlop={8}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
              >
                {process.env.EXPO_OS === 'ios' ? (
                  <SymbolView
                    name={(saved ? 'heart.fill' : 'heart') as never}
                    size={18}
                    tintColor={saved ? colors.accent : colors.inkMuted}
                  />
                ) : (
                  <MaterialIcons
                    name={saved ? 'favorite' : 'favorite-border'}
                    size={20}
                    color={saved ? colors.accent : colors.inkMuted}
                  />
                )}
              </Pressable>
            ) : null}
            {eventId ? <ListOverflow eventId={eventId} title={title} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ListOverflow({ eventId, title }: { eventId: string; title: string }) {
  const { t } = useTranslation();
  const [reportOpen, setReportOpen] = useState(false);

  async function onShare() {
    try {
      const result = await shareEventLink({ title, eventId });
      if (result === 'copied') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t('events.share'), t('events.linkCopied'));
      }
    } catch {
      Alert.alert(t('events.share'), t('events.shareLinkError'));
    }
  }

  async function onCopyLink() {
    try {
      await Clipboard.setStringAsync(buildEventWebUrl(eventId));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('events.copyLink'), t('events.shareLinkError'));
    }
  }

  return (
    <>
      <EventActionsMenu
        accessibilityLabel={t('events.moreActions')}
        shareLabel={t('events.share')}
        copyLinkLabel={t('events.copyLink')}
        reportLabel={t('events.report')}
        onShare={() => void onShare()}
        onCopyLink={() => void onCopyLink()}
        onReport={() => setReportOpen(true)}
        buttonStyle={{ width: 32, height: 32 }}
      />
      <ConfirmAction
        title={t('events.reportTitle')}
        message={t('events.reportMessage')}
        confirmLabel={t('events.reportConfirm')}
        cancelLabel={t('events.cancel')}
        isPresented={reportOpen}
        onIsPresentedChange={setReportOpen}
        onConfirm={() => setReportOpen(false)}
      />
    </>
  );
}

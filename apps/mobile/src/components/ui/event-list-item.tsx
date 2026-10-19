import { krPriceLabel } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { EventImage } from '@/components/ui/event-image';
import { PricePill, TagPills } from '@/components/ui/tag-pills';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const THUMB = 92;

type Props = {
  title: string;
  where: string;
  /** Start time, or the whole-day label. Shown before the venue. */
  time?: string;
  tags?: string[];
  imageUrl?: string | null;
  priceAmount?: number | null;
  dateBadge?: { weekday: string; day: string; month: string } | null;
  saved?: boolean;
  onPress: () => void;
  onSavePress?: () => void;
};

export function EventListItem({
  title,
  where,
  time,
  tags = [],
  imageUrl,
  priceAmount,
  dateBadge,
  saved,
  onPress,
  onSavePress,
}: Props) {
  const { t } = useTranslation();
  const priceLabel = krPriceLabel(priceAmount);
  const place = [time, where].filter((part) => part && part.length > 0).join(' · ');
  return (
    <View
      style={{
        backgroundColor: colors.cardDarkest,
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
              <View
                style={{
                  position: 'absolute',
                  left: 6,
                  bottom: -6,
                  boxShadow: shadow.hard,
                  borderRadius: radius.sm,
                }}
              >
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
                {place}
              </AppText>
              {priceLabel ? <PricePill label={priceLabel} /> : null}
            </View>
            <TagPills tags={tags} limit={2} size="sm" />
          </View>
        </Pressable>
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
      </View>
    </View>
  );
}

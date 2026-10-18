import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { EventImage } from '@/components/ui/event-image';
import { TagGroupIcon } from '@/components/ui/tag-group-list';
import { descriptionParts } from '@/lib/event-detail-format';
import type { HomeTagGroupId } from '@/lib/tag-groups';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  title: string;
  description?: string | null;
  where: string;
  period: string;
  categoryId?: HomeTagGroupId;
  categoryLabel?: string;
  imageUrl?: string | null;
  tags?: string[];
  dateBadge?: { weekday: string; day: string; month: string } | null;
  saved?: boolean;
  onPress: () => void;
  onSavePress?: () => void;
};

function Glyph({ sf, md }: { sf: string; md: keyof typeof MaterialIcons.glyphMap }) {
  return process.env.EXPO_OS === 'ios' ? (
    <SymbolView name={sf as never} size={14} tintColor={colors.inkMuted} />
  ) : (
    <MaterialIcons name={md} size={14} color={colors.inkMuted} />
  );
}

/** Home featured event: photo, then a light panel overlapping the bottom. */
export function FeaturedEventCard({
  title,
  description,
  where,
  period,
  categoryId,
  categoryLabel,
  imageUrl,
  tags = [],
  dateBadge,
  saved,
  onPress,
  onSavePress,
}: Props) {
  const { t } = useTranslation();
  const lead = descriptionParts(description).lead;
  return (
    <View style={{ gap: 0 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
        <View style={{ height: 210, borderRadius: radius.lg, overflow: 'hidden' }}>
          <EventImage imageUrl={imageUrl} tags={tags} />
          {dateBadge ? (
            <View style={{ position: 'absolute', left: space.md, top: space.md }}>
              <DateBox shadow badge={dateBadge} />
            </View>
          ) : null}
        </View>
        <View
          style={{
            marginTop: -36,
            marginHorizontal: space.md,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            padding: space.lg,
            gap: space.sm,
            boxShadow: shadow.card,
          }}
        >
          {categoryId && categoryLabel ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <TagGroupIcon id={categoryId} size={28} />
              <AppText
                variant="label"
                style={{ letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 11 }}
              >
                {categoryLabel}
              </AppText>
            </View>
          ) : null}
          <AppText variant="subtitle" numberOfLines={2}>
            {title}
          </AppText>
          {lead ? (
            <AppText variant="caption" numberOfLines={2} style={{ color: colors.inkMuted }}>
              {lead}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
              <Glyph sf="calendar" md="event" />
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {period}
              </AppText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
              <Glyph sf="mappin" md="location-on" />
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {where}
              </AppText>
            </View>
          </View>
        </View>
      </Pressable>
      {onSavePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? t('events.unfavorite') : t('events.favorite')}
          onPress={onSavePress}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: space.sm,
            right: space.sm,
            zIndex: 2,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.card,
          }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView
              name={(saved ? 'heart.fill' : 'heart') as never}
              size={18}
              tintColor={saved ? colors.accent : colors.ink}
            />
          ) : (
            <MaterialIcons
              name={saved ? 'favorite' : 'favorite-border'}
              size={20}
              color={saved ? colors.accent : colors.ink}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

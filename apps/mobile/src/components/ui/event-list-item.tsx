import { krPriceLabel } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { EventImage } from '@/components/ui/event-image';
import { TagPills } from '@/components/ui/tag-pills';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Props = {
  title: string;
  where: string;
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
  tags = [],
  imageUrl,
  priceAmount,
  dateBadge,
  saved,
  onPress,
  onSavePress,
}: Props) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={{ flex: 1, flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
      >
      <View style={{ width: 84, gap: space.sm }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: radius.md,
            overflow: 'hidden',
            backgroundColor: colors.accentSoft,
          }}
        >
          <EventImage imageUrl={imageUrl} tags={tags} />
        </View>
        {dateBadge ? <DateBox badge={dateBadge} compact /> : null}
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <AppText variant="subtitle" numberOfLines={2}>
          {title}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {where}
        </AppText>
        <TagPills tags={tags} limit={3} priceLabel={krPriceLabel(priceAmount)} />
      </View>
      </Pressable>
      {onSavePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? t('events.unfavorite') : t('events.favorite')}
          onPress={onSavePress}
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView
              name={(saved ? 'heart.fill' : 'heart') as never}
              size={20}
              tintColor={saved ? colors.accent : colors.primary}
            />
          ) : (
            <MaterialIcons
              name={saved ? 'favorite' : 'favorite-border'}
              size={22}
              color={saved ? colors.accent : colors.primary}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

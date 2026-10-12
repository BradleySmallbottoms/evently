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

type Props = {
  title: string;
  when: string;
  where: string;
  tags?: string[];
  imageUrl?: string | null;
  priceAmount?: number | null;
  dateBadge?: { weekday: string; day: string; month: string } | null;
  featured?: boolean;
  saved?: boolean;
  onPress: () => void;
  onSavePress?: () => void;
};

export function EventCard({
  title,
  where,
  tags = [],
  imageUrl,
  priceAmount,
  dateBadge,
  featured = false,
  saved,
  onPress,
  onSavePress,
}: Props) {
  const { t } = useTranslation();
  const priceLabel = krPriceLabel(priceAmount);

  return (
    <View
      style={{
        height: 280,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: colors.accentSoft,
        boxShadow: shadow.card,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={{ flex: 1 }}
      >
        <EventImage imageUrl={imageUrl} tags={tags} />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 88,
            experimental_backgroundImage:
              'linear-gradient(to bottom, rgba(17,24,32,0.45) 0%, rgba(17,24,32,0) 100%)',
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 160,
            experimental_backgroundImage:
              'linear-gradient(to bottom, rgba(17,24,32,0) 0%, rgba(17,24,32,0.72) 100%)',
          }}
        />
        {dateBadge ? (
          <View style={{ position: 'absolute', left: space.md, top: space.md }}>
            <DateBox badge={dateBadge} />
          </View>
        ) : null}
        <View
          style={{
            position: 'absolute',
            left: space.lg,
            right: space.lg,
            bottom: space.lg,
            gap: space.sm,
          }}
        >
          <View style={{ gap: 2 }}>
            {featured ? (
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: colors.accent,
                  borderRadius: radius.pill,
                  paddingHorizontal: space.sm,
                  paddingVertical: 2,
                }}
              >
                <AppText variant="label" style={{ color: colors.ink, fontWeight: '700' }}>
                  {t('events.featured')}
                </AppText>
              </View>
            ) : null}
            <View>
              <AppText
                numberOfLines={2}
                style={{
                  color: '#FFFFFF',
                  fontSize: 20,
                  lineHeight: 24,
                  fontWeight: '700',
                  paddingRight: priceLabel ? 58 : 0,
                }}
              >
                {title}
              </AppText>
              {priceLabel ? (
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', top: 2, right: 0 }}
                >
                  <PricePill label={priceLabel} />
                </View>
              ) : null}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.92)' }}>
              {where}
            </AppText>
          </View>
          <TagPills tags={tags} limit={3} />
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
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView
              name={(saved ? 'heart.fill' : 'heart') as never}
              size={22}
              tintColor={saved ? colors.accent : '#FFFFFF'}
            />
          ) : (
            <MaterialIcons
              name={saved ? 'favorite' : 'favorite-border'}
              size={24}
              color={saved ? colors.accent : '#FFFFFF'}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

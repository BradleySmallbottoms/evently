import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { DateBox } from '@/components/ui/date-box';
import { EventImage } from '@/components/ui/event-image';
import { dateBadge } from '@/lib/event-format';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export type PopularNowItem = {
  id: string;
  title: string;
  startsAt: string;
  imageUrl: string | null;
  tags: string[];
};

type Props = {
  locale: string;
  items: PopularNowItem[];
  onShowAll: () => void;
  onPress: (id: string) => void;
};

/** Photo grid of events people have saved or marked as coming. Each tile shows the date and title. */
export function PopularNow({ locale, items, onShowAll, onPress }: Props) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const columns = width >= 320 ? 3 : 2;
  const gap = space.sm;
  const tile = width > 0 ? (width - gap * (columns - 1)) / columns : 0;
  const shown = items.slice(0, columns * 3);

  if (items.length === 0) return null;

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{
          paddingHorizontal: space.xl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <AppText variant="subtitle">{t('events.popularNow')}</AppText>
        {/* <Pressable accessibilityRole="button" onPress={onShowAll}>
          <AppText variant="label" style={{ color: colors.info }}>
            {t('events.seeAll')}
          </AppText>
        </Pressable> */}
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{
          marginHorizontal: space.xl,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
        }}
      >
        {tile > 0
          ? shown.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => onPress(item.id)}
                style={{
                  width: tile,
                  height: tile,
                  borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  overflow: 'hidden',
                  backgroundColor: colors.accentSoft,
                }}
              >
                <EventImage imageUrl={item.imageUrl} tags={item.tags} />
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 72,
                    experimental_backgroundImage:
                      'linear-gradient(to bottom, rgba(17,24,32,0) 0%, rgba(17,24,32,0.78) 100%)',
                  }}
                />
                <View style={{ position: 'absolute', top: space.sm, left: space.sm }}>
                  <DateBox shadow={true} badge={dateBadge(item.startsAt, locale)} compact />
                </View>
                <AppText
                  numberOfLines={2}
                  style={{
                    position: 'absolute',
                    left: space.sm,
                    right: space.sm,
                    bottom: space.sm,
                    color: '#FFFFFF',
                    fontSize: 13,
                    lineHeight: 16,
                    fontWeight: '700',
                  }}
                >
                  {item.title}
                </AppText>
              </Pressable>
            ))
          : null}
      </View>
    </View>
  );
}

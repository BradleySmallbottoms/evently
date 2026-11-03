import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventImage } from '@/components/ui/event-image';
import { MaxContentWidth } from '@/constants/theme';
import { placeholderSlotsByEvent } from '@/lib/event-placeholder';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { DatePill } from './date-pill';

export type HomeFeaturedItem = {
  id: string;
  title: string;
  when: string;
  where: string;
  imageUrl?: string | null;
  tags: string[];
  featured?: boolean;
};

type Props = {
  items: HomeFeaturedItem[];
  onPress: (id: string) => void;
};

const CARD_HEIGHT = 248;

export function HomeFeatured({ items, onPress }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, MaxContentWidth);
  const [index, setIndex] = useState(0);
  const placeholderSlots = useMemo(() => placeholderSlotsByEvent(items), [items]);
  if (items.length === 0) return null;

  return (
    <View style={{ gap: space.md }}>
      <FlatList
        horizontal
        nestedScrollEnabled
        pagingEnabled
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onMomentumScrollEnd={(event) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
          setIndex(Math.min(Math.max(next, 0), items.length - 1));
        }}
        getItemLayout={(_, itemIndex) => ({
          length: pageWidth,
          offset: pageWidth * itemIndex,
          index: itemIndex,
        })}
        renderItem={({ item }) => (
          <View style={{ width: pageWidth, paddingHorizontal: space.xl }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.when}`}
              onPress={() => onPress(item.id)}
              style={{
                height: CARD_HEIGHT,
                borderRadius: radius.lg,
                borderCurve: 'continuous',
                overflow: 'hidden',
                backgroundColor: colors.overlay,
              }}
            >
              <EventImage
                imageUrl={item.imageUrl}
                tags={item.tags}
                eventId={item.id}
                placeholderSlot={placeholderSlots.get(item.id)}
                style={{ width: '100%', height: '100%' }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 150,
                  experimental_backgroundImage:
                    'linear-gradient(to bottom, rgba(17,24,32,0) 0%, rgba(17,24,32,0.82) 100%)',
                }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: space.lg,
                  top: space.lg,
                  right: space.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                }}
              >
                {item.featured ? (
                  <View
                    style={{
                      backgroundColor: 'rgba(17,24,32,0.72)',
                      borderRadius: radius.xs,
                      paddingHorizontal: space.sm,
                      paddingVertical: 3,
                    }}
                  >
                    <AppText
                      variant="label"
                      style={{
                        color: '#FFFFFF',
                        fontSize: 11,
                        letterSpacing: 0.6,
                        fontWeight: '700',
                      }}
                    >
                      {t('events.featured').toLocaleUpperCase()}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <View
                style={{
                  position: 'absolute',
                  left: space.lg,
                  right: space.lg,
                  bottom: space.lg,
                  gap: 4,
                }}
              >
                <AppText
                  numberOfLines={2}
                  style={{ color: '#FFFFFF', fontSize: 28, lineHeight: 32, fontWeight: '700' }}
                >
                  {item.title}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <DatePill label={item.when} />
                  <AppText
                    numberOfLines={1}
                    style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14 }}
                  >
                    {item.where}
                  </AppText>
                </View>
              </View>
            </Pressable>
          </View>
        )}
      />
      {items.length > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {items.map((item, dot) => (
            <View
              key={item.id}
              style={{
                width: dot === index ? 8 : 6,
                height: dot === index ? 8 : 6,
                borderRadius: radius.pill,
                backgroundColor: dot === index ? colors.ink : colors.line,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

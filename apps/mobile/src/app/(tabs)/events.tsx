import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EventListItem } from '@/components/ui/event-list-item';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { dateBadge } from '@/lib/event-format';
import { listTags, namesForTagIds } from '@/lib/events';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function EventsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const { point } = useDiscoveryPoint();
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const events = useInfinitePublicEvents(
    point.data,
    { sort: 'soonest' },
    ['browse-events', point.data],
  );
  const eventItems = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={eventItems}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingBottom: BottomTabInset + space.xxxl, gap: space.md }}
        ListHeaderComponent={
          <View
            style={{
              paddingHorizontal: space.xl,
              paddingTop: space.xl,
              paddingBottom: space.md,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <AppText variant="title">{t('tabs.events')}</AppText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/map')}>
              <AppText variant="label" style={{ color: colors.info }}>
                {t('tabs.map')}
              </AppText>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <AppText variant="caption" style={{ textAlign: 'center' }}>
              {t('events.loadingMore')}
            </AppText>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.xl }}>
            <EventListItem
              title={item.title}
              where={item.venueName ?? item.publisherName}
              tags={namesForTagIds(item.tagIds, tags.data?.items)}
              imageUrl={item.imageUrl}
              priceAmount={item.priceAmount}
              dateBadge={dateBadge(item.startsAt, locale)}
              onPress={() => router.push(`/events/${item.id}`)}
            />
          </View>
        )}
      />
    </View>
  );
}

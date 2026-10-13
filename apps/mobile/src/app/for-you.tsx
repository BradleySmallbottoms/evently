import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { MaxContentWidth } from '@/constants/theme';
import { dateBadge } from '@/lib/event-format';
import { listTags, namesForTagIds } from '@/lib/events';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function ForYouScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const { point, preferences } = useDiscoveryPoint();
  const preferredTagIds = preferences.data?.tagIds ?? [];
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const events = useInfinitePublicEvents(
    preferredTagIds.length > 0 ? point.data : undefined,
    { tagIds: preferredTagIds, sort: 'soonest' },
    ['for-you-all', point.data?.lat, point.data?.lng, point.data?.radiusM, preferredTagIds],
  );
  const eventItems = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', paddingTop: insets.top }}>
      <FlatList
        style={{ width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={eventItems}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.md }}>
            <View style={{ paddingHorizontal: space.xl }}>
              <BackPill />
            </View>
            <AppText variant="title" style={{ paddingHorizontal: space.xl }}>
              {t('events.forYou')}
            </AppText>
          </View>
        }
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <ActivityIndicator color={colors.ink} />
          ) : null
        }
        ListEmptyComponent={
          events.isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
            </View>
          ) : (
            <EmptyState title={t('events.forYou')} body={t('events.empty')} />
          )
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

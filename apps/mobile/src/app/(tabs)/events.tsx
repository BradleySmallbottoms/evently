import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { EventListItem } from '@/components/ui/event-list-item';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { dateBadge, shownClock } from '@/lib/event-format';
import { shownWhen } from '@/lib/span-occasions';
import { listTags, namesForTagIds } from '@/lib/events';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function EventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const { point, identity } = useDiscoveryPoint();
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = new Set((saved.data?.items ?? []).map((item) => item.id));
  function toggleSave(eventId: string) {
    if (!identity.data) return;
    const next = savedIds.has(eventId)
      ? unsaveEvent(identity.data, eventId)
      : saveEvent(identity.data, eventId);
    void next.then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }));
  }
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
          <View style={{ paddingTop: space.sm }}>
            <View
              style={{
                paddingHorizontal: space.xl,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
              }}
            >
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                {t('home.title')}
              </AppText>
              <View style={{ marginLeft: 'auto' }}>
                <CircleIconButton
                  sf="map"
                  md="map"
                  accessibilityLabel={t('tabs.map')}
                  onPress={() => router.push('/map')}
                />
              </View>
            </View>
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
              time={shownClock(
                shownWhen(item, new Date()).startsAt,
                shownWhen(item, new Date()).endsAt,
                locale,
                t('events.wholeDay'),
              )}
              dateBadge={dateBadge(shownWhen(item, new Date()).startsAt, locale)}
              saved={savedIds.has(item.id)}
              onSavePress={() => toggleSave(item.id)}
              onPress={() => router.push(`/events/${item.id}`)}
            />
          </View>
        )}
      />
    </View>
  );
}

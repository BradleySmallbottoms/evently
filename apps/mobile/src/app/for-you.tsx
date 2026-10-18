import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { MaxContentWidth } from '@/constants/theme';
import { dateBadge, shownClock } from '@/lib/event-format';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { shownWhen } from '@/lib/span-occasions';
import { listTags, namesForTagIds } from '@/lib/events';
import { loadHomeTagIds } from '@/lib/home-tag-selection';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { useForYouEvents } from '@/lib/use-for-you';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function ForYouScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const { point, identity } = useDiscoveryPoint();
  const storedTagIds = useQuery({
    queryKey: ['home-tag-ids'],
    queryFn: loadHomeTagIds,
    staleTime: Infinity,
  });
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
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
  const forYou = useForYouEvents({
    point: point.data,
    identity: identity.isSuccess ? identity.data : undefined,
    tagsReady: storedTagIds.isSuccess,
    selectedTagIds: storedTagIds.data ?? [],
    featuredIds: new Set(),
    limit: 100,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', paddingTop: insets.top }}>
      <FlatList
        style={{ width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={forYou.items}
        keyExtractor={(item) => item.id}
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
        ListEmptyComponent={
          forYou.isLoading ? (
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

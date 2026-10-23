import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { dateBadge, shownClock } from '@/lib/event-format';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { shownWhen } from '@/lib/span-occasions';
import { listPublicEvents, listTags, namesForTagIds } from '@/lib/events';
import { eventListFreshness } from '@/lib/query-client';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function TicketsScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { point, identity } = useDiscoveryPoint();
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const nearby = useQuery({
    queryKey: ['ticket-links', point.data?.lat, point.data?.lng, point.data?.radiusM],
    ...eventListFreshness,
    enabled: point.isSuccess,
    queryFn: () => listPublicEvents(point.data!),
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
  const tickets = (nearby.data?.items ?? []).filter((event) =>
    event.links.some((link) => link.type === 'tickets' || link.type === 'registration'),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: space.xl,
          paddingBottom: space.xxxl,
          gap: space.md,
        }}
      >
        <AppText variant="title">{t('profile.tickets')}</AppText>
        {nearby.isPending ? null : tickets.length === 0 ? (
          <EmptyState title={t('profile.ticketsEmptyTitle')} body={t('profile.ticketsEmptyBody')} />
        ) : (
          tickets.map((item) => (
            <EventListItem
              key={item.id}
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
                item.timezone,
              )}
              dateBadge={dateBadge(shownWhen(item, new Date()).startsAt, locale)}
              saved={savedIds.has(item.id)}
              onSavePress={() => toggleSave(item.id)}
              onPress={() => router.push(`/events/${item.id}`)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

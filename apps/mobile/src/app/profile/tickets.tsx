import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { dateBadge } from '@/lib/event-format';
import { listPublicEvents, listTags, namesForTagIds } from '@/lib/events';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function TicketsScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { point } = useDiscoveryPoint();
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const nearby = useQuery({
    queryKey: ['ticket-links', point.data?.lat, point.data?.lng, point.data?.radiusM],
    enabled: point.isSuccess,
    queryFn: () => listPublicEvents(point.data!),
  });
  const tickets = (nearby.data?.items ?? []).filter((event) =>
    event.links.some((link) => link.type === 'tickets' || link.type === 'registration'),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
      >
        <AppText variant="label" style={{ color: colors.accent }}>
          {t('preferences.back')}
        </AppText>
      </Pressable>
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
              dateBadge={dateBadge(item.startsAt, locale)}
              onPress={() => router.push(`/events/${item.id}`)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

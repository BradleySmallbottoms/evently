import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { CategoryChips } from '@/components/ui/category-chips';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { dateBadge } from '@/lib/event-format';
import { shownWhen } from '@/lib/span-occasions';
import { listTags, namesForTagIds } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { listEventLists, listSavedEvents, unsaveEvent } from '@/lib/library';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function SavedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [segment, setSegment] = useState<'events' | 'lists'>('events');
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const lists = useQuery({
    queryKey: ['event-lists', identity.data?.userId],
    enabled: identity.isSuccess && segment === 'lists',
    queryFn: () => listEventLists(identity.data!),
  });

  const events = saved.data?.items ?? [];
  const listRows =
    lists.data?.items.flatMap((list) =>
      list.events.map((event) => ({ ...event, listName: list.name, key: `${list.id}:${event.id}` })),
    ) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        data={segment === 'events' ? events : listRows}
        keyExtractor={(item, index) =>
          segment === 'lists' ? (listRows[index]?.key ?? item.id) : item.id
        }
        contentContainerStyle={{ paddingBottom: BottomTabInset + space.xxxl, gap: space.md }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.sm }}>
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
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={segment === 'events' ? t('saved.emptyTitle') : t('saved.listsEmptyTitle')}
            body={segment === 'events' ? t('saved.emptyBody') : t('saved.listsEmptyBody')}
            actionLabel={segment === 'events' ? t('saved.browse') : undefined}
            onAction={segment === 'events' ? () => router.push('/') : undefined}
          />
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.xl, gap: space.xs }}>
            {'listName' in item ? (
              <AppText variant="label" style={{ color: colors.ink }}>
                {String(item.listName)}
              </AppText>
            ) : null}
            <EventListItem
              title={item.title}
              where={item.venueName ?? item.publisherName}
              tags={namesForTagIds(item.tagIds, tags.data?.items)}
              imageUrl={item.imageUrl}
              priceAmount={item.priceAmount}
              dateBadge={dateBadge(shownWhen(item, new Date()).startsAt, locale)}
              eventId={item.id}
              saved={segment === 'events'}
              onPress={() => router.push(`/events/${item.id}`)}
              onSavePress={
                segment === 'events' && identity.data
                  ? () => {
                      void unsaveEvent(identity.data!, item.id).then(() =>
                        queryClient.invalidateQueries({ queryKey: ['saved-events'] }),
                      );
                    }
                  : undefined
              }
            />
          </View>
        )}
      />
    </View>
  );
}

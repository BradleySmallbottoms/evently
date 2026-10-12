import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { EventListItem } from '@/components/ui/event-list-item';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { SearchBar } from '@/components/ui/search-bar';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { dateBadge } from '@/lib/event-format';
import { listTags, namesForTagIds } from '@/lib/events';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type DateFilterId = 'any' | 'today' | 'tomorrow' | 'weekend' | 'week';

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function dateBounds(id: DateFilterId): { from?: string; to?: string } {
  if (id === 'any') return {};
  const today = startOfDay(new Date());
  if (id === 'today') return { from: today.toISOString(), to: endOfDay(today).toISOString() };
  if (id === 'tomorrow') {
    const day = new Date(today);
    day.setDate(day.getDate() + 1);
    return { from: day.toISOString(), to: endOfDay(day).toISOString() };
  }
  if (id === 'weekend') {
    const weekday = today.getDay();
    const saturday = new Date(today);
    if (weekday === 0) saturday.setDate(today.getDate() - 1);
    else if (weekday !== 6) saturday.setDate(today.getDate() + (6 - weekday));
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    return { from: saturday.toISOString(), to: endOfDay(sunday).toISOString() };
  }
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  return { from: today.toISOString(), to: endOfDay(end).toISOString() };
}

export default function SearchScreen() {
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const inputRef = useRef<TextInput>(null);
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [q, setQ] = useState('');
  const [tagId, setTagId] = useState('all');
  const [price, setPrice] = useState<'any' | 'free' | 'paid'>('any');
  const [dateId, setDateId] = useState<DateFilterId>('any');
  const [useFallbackCenter, setUseFallbackCenter] = useState(false);

  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [focus]);

  const { identity, point } = useDiscoveryPoint(useFallbackCenter);
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const bounds = dateBounds(dateId);
  const events = useInfinitePublicEvents(
    point.data,
    {
      q: q.trim() || undefined,
      tagId: tagId === 'all' ? undefined : tagId,
      price: price === 'any' ? undefined : price,
      from: bounds.from,
      to: bounds.to,
      sort: 'soonest',
    },
    ['search-events', point.data, q, tagId, price, dateId],
  );
  const eventItems = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = new Set((saved.data?.items ?? []).map((item) => item.id));

  const dateOptions = [
    { id: 'any', label: t('events.dateAny') },
    { id: 'today', label: t('events.dateToday') },
    { id: 'tomorrow', label: t('events.dateTomorrow') },
    { id: 'weekend', label: t('events.dateWeekend') },
    { id: 'week', label: t('events.dateWeek') },
  ];
  const tagOptions = [
    { id: 'all', label: t('events.categoryAll') },
    ...(tags.data?.items ?? []).map((tag) => ({ id: tag.id, label: tag.name })),
  ];
  const placeOptions = [
    { id: 'nearby', label: t('events.locationNearby') },
    { id: 'soderhamn', label: t('events.locationSoderhamn') },
  ];
  const priceOptions = [
    { id: 'any', label: t('events.priceAny') },
    { id: 'free', label: t('events.free') },
    { id: 'paid', label: t('events.pricePaid') },
  ];

  function resetFilters() {
    setQ('');
    setTagId('all');
    setPrice('any');
    setDateId('any');
    setUseFallbackCenter(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={eventItems}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingBottom: BottomTabInset + space.xxxl, gap: space.md }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.xl }}>
            <AppText variant="title" style={{ paddingHorizontal: space.xl }}>
              {t('tabs.search')}
            </AppText>
            <View style={{ paddingHorizontal: space.xl }}>
              <SearchBar
                inputRef={inputRef}
                value={q}
                onChangeText={setQ}
                placeholder={t('events.searchPlaceholder')}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: space.sm,
                paddingHorizontal: space.xl,
              }}
            >
              <FilterDropdown
                label={t('events.filterDateLabel')}
                value={dateId}
                options={dateOptions}
                onChange={(id) => setDateId(id as DateFilterId)}
              />
              <FilterDropdown
                label={t('events.filterTagLabel')}
                value={tagId}
                options={tagOptions}
                onChange={setTagId}
              />
              <FilterDropdown
                label={t('events.filterPlaceLabel')}
                value={useFallbackCenter ? 'soderhamn' : 'nearby'}
                options={placeOptions}
                onChange={(id) => setUseFallbackCenter(id === 'soderhamn')}
              />
              <FilterDropdown
                label={t('events.price')}
                value={price}
                options={priceOptions}
                onChange={(id) => setPrice(id as 'any' | 'free' | 'paid')}
              />
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
        ListEmptyComponent={
          events.isSuccess ? (
            <EmptyState
              title={t('events.empty')}
              body={t('events.searchEmpty')}
              actionLabel={t('events.resetFilters')}
              onAction={resetFilters}
            />
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
              saved={savedIds.has(item.id)}
              onPress={() => router.push(`/events/${item.id}`)}
              onSavePress={() => {
                if (!identity.data) return;
                const next = savedIds.has(item.id)
                  ? unsaveEvent(identity.data, item.id)
                  : saveEvent(identity.data, item.id);
                void next.then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }));
              }}
            />
          </View>
        )}
      />
    </View>
  );
}

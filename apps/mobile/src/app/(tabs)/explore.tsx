import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  View,
  type FlatListProps,
} from 'react-native';

import { ThemedScreen } from '@/components/themed-screen';
import { CategoryFiltersSheet } from '@/components/native/category-filters-sheet';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { TagGroupList } from '@/components/ui/tag-group-list';
import { presentAddToCalendar } from '@/lib/add-to-calendar';
import { calendarDraft } from '@/lib/calendar-draft';
import { eventPlaceLabel, shortDateLabel, shownClock } from '@/lib/event-format';
import { buildEventWebUrl, shareEventLink } from '@/lib/event-share';
import { listTags, namesForTagIds } from '@/lib/events';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { groupHomeTags } from '@/lib/tag-groups';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { useEventCount } from '@/lib/use-event-count';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { ExploreCard } from '@/components/tabs/explore-card';
import { readEventVideoUrl } from '@/components/tabs/explore-media';

function tagIdsFromParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  return raw.split(',').filter(Boolean);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left);
  return right.every((id) => ids.has(id));
}

export default function ExploreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const { identity, point } = useDiscoveryPoint();
  const { tagIds: tagParam, tagAt } = useLocalSearchParams<{ tagIds?: string; tagAt?: string }>();
  const [tagIds, setTagIds] = useState(() => tagIdsFromParam(tagParam));
  const appliedTagAt = useRef(typeof tagAt === 'string' ? tagAt : null);
  useEffect(() => {
    if (typeof tagAt !== 'string' || tagAt.length === 0 || tagAt === appliedTagAt.current) return;
    appliedTagAt.current = tagAt;
    setTagIds(tagIdsFromParam(tagParam));
  }, [tagAt, tagParam]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [countDelta, setCountDelta] = useState<Record<string, number>>({});
  const tagKey = [...tagIds].sort().join('\n');

  const tags = useQuery({
    queryKey: ['tags', 'upcoming', 'place', point.data?.lat, point.data?.lng, point.data?.radiusM],
    enabled: point.isSuccess,
    queryFn: () => listTags({ near: point.data! }),
  });
  const groups = useMemo(() => groupHomeTags(tags.data?.items ?? []), [tags.data]);
  const events = useInfinitePublicEvents(
    point.data,
    {
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      sort: 'soonest',
    },
    ['explore-events', point.data?.lat, point.data?.lng, point.data?.radiusM, tagKey],
  );
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = useMemo(
    () => new Set((saved.data?.items ?? []).map((item) => item.id)),
    [saved.data],
  );
  const [saveOverride, setSaveOverride] = useState<Record<string, boolean>>({});
  const shownSavedIds = useMemo(() => {
    const next = new Set(savedIds);
    for (const [id, on] of Object.entries(saveOverride)) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  }, [saveOverride, savedIds]);
  const savedIdKey = [...savedIds].sort().join('\n');
  useEffect(() => {
    setSaveOverride({});
  }, [savedIdKey]);
  const eventCount = useEventCount(
    point.data,
    { tagIds: tagIds.length > 0 ? tagIds : undefined },
    filtersOpen && point.isSuccess,
  );
  const items = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );

  const listRef = useRef<FlatList<(typeof items)[number]>>(null);
  useEffect(() => {
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [tagKey]);
  useEffect(() => {
    if (!events.hasNextPage || events.isFetchingNextPage) return;
    if (activeIndex < items.length - 3) return;
    void events.fetchNextPage();
  }, [
    activeIndex,
    events.hasNextPage,
    events.isFetchingNextPage,
    events.fetchNextPage,
    items.length,
  ]);

  const viewability = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef<FlatListProps<unknown>['onViewableItemsChanged']>(
    ({ viewableItems }) => {
      const next = viewableItems[0]?.index;
      if (next != null) setActiveIndex(next);
    },
  ).current;

  function toggleSave(eventId: string) {
    if (!identity.data) return;
    const wasSaved = shownSavedIds.has(eventId);
    setSaveOverride((prev) => ({ ...prev, [eventId]: !wasSaved }));
    setCountDelta((prev) => ({
      ...prev,
      [eventId]: (prev[eventId] ?? 0) + (wasSaved ? -1 : 1),
    }));
    const next = wasSaved ? unsaveEvent(identity.data, eventId) : saveEvent(identity.data, eventId);
    void next
      .then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }))
      .catch(() => {
        setSaveOverride((prev) => {
          const copy = { ...prev };
          delete copy[eventId];
          return copy;
        });
        setCountDelta((prev) => ({
          ...prev,
          [eventId]: (prev[eventId] ?? 0) + (wasSaved ? 1 : -1),
        }));
      });
  }

  async function addToCalendar(event: (typeof items)[number]) {
    const when = shownWhen(event, new Date());
    const place =
      event.mode === 'physical'
        ? eventPlaceLabel({
            mode: event.mode,
            venueName: event.venueName,
            city: event.meta?.address?.city,
            onlineUrl: event.onlineUrl,
            missingVenue: '',
            missingUrl: '',
          })
        : null;
    let url: string | null = null;
    try {
      url = buildEventWebUrl(event.id);
    } catch {
      url = null;
    }
    try {
      const result = await presentAddToCalendar(
        calendarDraft({
          title: event.title,
          startsAt: when.startsAt,
          endsAt: when.endsAt,
          allDay: isWholeDay(when.startsAt, when.endsAt),
          location: place || null,
          notes: [event.summary?.trim(), url].filter(Boolean).join('\n') || null,
          timeZone: event.timezone,
          url,
        }),
      );
      if (result === 'unavailable') {
        Alert.alert(t('events.detail.addToCalendar'), t('events.calendarUnavailable'));
      }
    } catch {
      Alert.alert(t('events.detail.addToCalendar'), t('events.calendarError'));
    }
  }

  const pending = events.isPending && !events.data;
  const empty = events.isSuccess && !events.isPlaceholderData && items.length === 0;

  return (
    <ThemedScreen
      background="overlay"
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next > 0 && next !== pageHeight) setPageHeight(next);
      }}
    >
      {pageHeight > 0 && items.length > 0 ? (
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(item) => item.id}
          pagingEnabled
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          snapToInterval={pageHeight}
          snapToAlignment="start"
          disableIntervalMomentum
          getItemLayout={(_, index) => ({
            length: pageHeight,
            offset: pageHeight * index,
            index,
          })}
          viewabilityConfig={viewability}
          onViewableItemsChanged={onViewableItemsChanged}
          renderItem={({ item, index }) => {
            const when = shownWhen(item, new Date());
            const date = shortDateLabel(when.startsAt, locale, item.timezone).toLocaleUpperCase(
              locale,
            );
            const clock = shownClock(
              when.startsAt,
              when.endsAt,
              locale,
              t('events.wholeDay'),
              item.timezone,
            );
            const interest = Math.max(0, item.numSaved + (countDelta[item.id] ?? 0));
            return (
              <ExploreCard
                title={item.title}
                when={`${date} • ${clock}`}
                where={eventPlaceLabel({
                  mode: item.mode,
                  venueName: item.venueName,
                  city: item.meta?.address?.city,
                  onlineUrl: item.onlineUrl,
                  missingVenue: t('events.missingVenue'),
                  missingUrl: t('events.missingUrl'),
                })}
                tags={namesForTagIds(item.tagIds, tags.data?.items)}
                imageUrl={item.imageUrl}
                eventId={item.id}
                focal={item.imageFocal}
                videoUrl={readEventVideoUrl(item)}
                saved={shownSavedIds.has(item.id)}
                interestCount={interest}
                active={index === activeIndex}
                height={pageHeight}
                onOpen={() => router.push(`/events/${item.id}`)}
                onSave={() => toggleSave(item.id)}
                onCalendar={() => {
                  void addToCalendar(item);
                }}
                onShare={() => {
                  void shareEventLink({ title: item.title, eventId: item.id });
                }}
              />
            );
          }}
        />
      ) : (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}
        >
          {pending ? (
            <ActivityIndicator accessibilityLabel={t('events.loading')} color="#FFFFFF" />
          ) : (
            <AppText variant="body" style={{ color: '#FFFFFF', textAlign: 'center' }}>
              {events.isError ? t('events.loadError') : empty ? t('events.empty') : ''}
            </AppText>
          )}
        </View>
      )}

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + space.sm,
          gap: space.xs,
          flexDirection: 'row',
          paddingHorizontal: space.sm,
        }}
      >
        {/* <View
          style={{
            paddingHorizontal: space.xl,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View></View>
          <AppText style={{ color: '#FFFFFF', fontSize: 34, lineHeight: 40, fontWeight: '800' }}>
            {t('tabs.explore')}
          </AppText>

        </View> */}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.sm }}
        >
          <FilterChip
            label={t('events.categoryAll')}
            selected={tagIds.length === 0}
            onPress={() => setTagIds([])}
          />
          {groups.map((group) => {
            const ids = group.tags.map((tag) => tag.id);
            return (
              <FilterChip
                key={group.id}
                label={t(`events.tagGroup.${group.id}`)}
                selected={sameIds(tagIds, ids)}
                onPress={() => setTagIds(sameIds(tagIds, ids) ? [] : ids)}
              />
            );
          })}
        </ScrollView>
        {/* <CircleIconButton
          plain
          sf="slider.horizontal.3"
          md="tune"
          tintColor="#FFFFFF"
          accessibilityLabel={t('explore.filters')}
          onPress={() => setFiltersOpen(true)}
          style={{ backgroundColor: 'rgba(17,24,32,1)' }}
        /> */}
      </View>

      <CategoryFiltersSheet
        isPresented={filtersOpen}
        onDismiss={() => setFiltersOpen(false)}
        eventCount={eventCount}
      >
        <TagGroupList tags={tags.data?.items ?? []} selectedIds={tagIds} onChange={setTagIds} />
      </CategoryFiltersSheet>
    </ThemedScreen>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 36,
        justifyContent: 'center',
        borderRadius: radius.pill,
        paddingHorizontal: space.lg,
        backgroundColor: selected ? colors.accent : 'rgba(17,24,32,0.45)',
        borderWidth: selected ? 0 : 1,
        borderColor: 'rgba(255,255,255,0.28)',
      }}
    >
      <AppText
        style={{
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: '700',
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

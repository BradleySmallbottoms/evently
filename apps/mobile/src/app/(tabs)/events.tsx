import { canAddSavedArea, krPriceLabel } from '@local-events/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';

import { AreaTagGroupsSheet } from '@/components/native/area-tag-groups-sheet';
import { LocationMenu } from '@/components/native/location-menu';
import { CalendarEventRow } from '@/components/calendar/calendar-event-row';
import { SponsoredEventCard } from '@/components/ui/sponsored-event-card';
import { CalendarDateSheet } from '@/components/calendar/date-sheet';
import { CalendarFilterBar } from '@/components/calendar/filter-bar';
import { CalendarFilterSheet } from '@/components/calendar/filter-sheet';
import { MonthStrip } from '@/components/calendar/month-strip';
import { QuickDates, type QuickDateId } from '@/components/calendar/quick-dates';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { queryPointForArea } from '@/lib/area-point';
import { pointForPlace } from '@/lib/location-draft';
import { useEventCount } from '@/lib/use-event-count';
import {
  addDays,
  boundsIso,
  formatDayShort,
  formatRangeShort,
  formatSectionTitle,
  monthStamps,
  partsInZone,
  weekendStamps,
  type DayStamp,
} from '@/lib/calendar-range';
import { clampRangeToToday, monthOnNewDay } from '@/lib/calendar-today';
import { useCalendarToday } from '@/lib/use-calendar-today';
import { listTags, namesForTagIds } from '@/lib/events';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { useSaveDiscoveryRadius } from '@/lib/save-discovery-radius';
import { groupHomeTags, retainedTagIds } from '@/lib/tag-groups';
import { useAreaTagPrompt } from '@/lib/use-area-tag-prompt';
import {
  NEARBY_PLACE_ID,
  radiiForPlaces,
  setDiscoveryPlaceId,
  useDiscoveryPoint,
} from '@/lib/use-discovery-point';
import { nearbyLocationDetail } from '@/lib/nearby-place-name';
import { useNearbyPlaceName } from '@/lib/use-nearby-place-name';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Range = { from: DayStamp; to: DayStamp };
type Price = 'any' | 'free' | 'paid';
type EventOccasion = {
  startsAt: string;
  endsAt: string;
  venueName?: string | null;
  location?: { lat: number; lng: number } | null;
};

function clock(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export default function EventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const today = useCalendarToday();
  const [month, setMonth] = useState(() => {
    const stamp = partsInZone(new Date());
    return { y: stamp.y, m: stamp.m };
  });
  const [quick, setQuick] = useState<QuickDateId | null>(null);
  const [custom, setCustom] = useState<Range | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [price, setPrice] = useState<Price>('any');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState<{ placeId: string; radiusM: number } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const shownMonth = monthOnNewDay(month, today);
  if (shownMonth !== month) setMonth(shownMonth);
  const shownCustom = clampRangeToToday(custom, today);
  const shownQuick = shownCustom == null && quick === 'custom' ? null : quick;
  if (shownCustom !== custom) setCustom(shownCustom);
  if (shownQuick !== quick) setQuick(shownQuick);

  const { identity, preferences, point, placeId, radiusM, radiusMap, device } = useDiscoveryPoint();
  const nearbyName = useNearbyPlaceName(placeId === NEARBY_PLACE_ID ? device.fix : null);
  const saveDiscoveryRadius = useSaveDiscoveryRadius(identity.data);
  const areaTags = useAreaTagPrompt(identity.data);
  const tags = useQuery({
    queryKey: ['tags', 'upcoming', 'place', point.data?.lat, point.data?.lng, point.data?.radiusM],
    enabled: point.isSuccess,
    queryFn: () => listTags({ near: point.data! }),
  });
  const knownTagIds = useMemo(
    () => new Set((tags.data?.items ?? []).map((tag) => tag.id)),
    [tags.data],
  );
  const listedTagIds = tags.isSuccess ? retainedTagIds(tagIds, knownTagIds) : tagIds;
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = new Set((saved.data?.items ?? []).map((item) => item.id));

  const range = useMemo<Range>(() => {
    if (shownQuick === 'today') return { from: today, to: today };
    if (shownQuick === 'tomorrow') {
      const day = addDays(today, 1);
      return { from: day, to: day };
    }
    if (shownQuick === 'weekend') return weekendStamps(today);
    if (shownQuick === 'custom' && shownCustom) return shownCustom;
    return monthStamps(shownMonth.y, shownMonth.m);
  }, [shownCustom, shownMonth.m, shownMonth.y, shownQuick, today]);
  const iso = boundsIso(range.from, range.to);
  const tagKey = [...listedTagIds].sort().join('\n');
  const locationPoint = useMemo(() => {
    if (!locationOpen || !locationDraft) return undefined;
    return (
      pointForPlace(
        locationDraft.placeId,
        locationDraft.radiusM,
        NEARBY_PLACE_ID,
        preferences.data?.areas ?? [],
        device.fix,
      ) ?? undefined
    );
  }, [device.fix, locationDraft, locationOpen, preferences.data?.areas]);
  const locationEventCount = useEventCount(
    locationPoint,
    {
      from: iso.from,
      to: iso.to,
      tagIds: listedTagIds.length > 0 ? listedTagIds : undefined,
      price: price === 'any' ? undefined : price,
    },
    locationOpen,
  );
  const events = useInfinitePublicEvents(
    point.data,
    {
      from: iso.from,
      to: iso.to,
      tagIds: listedTagIds.length > 0 ? listedTagIds : undefined,
      price: price === 'any' ? undefined : price,
      sort: 'soonest',
    },
    ['browse-events', point.data, iso.from, iso.to, tagKey, price],
  );
  const sections = useMemo(() => {
    const items = events.data?.pages.flatMap((page) => page.items) ?? [];
    const now = new Date();
    const rangeStart = new Date(iso.from);
    const rangeEnd = new Date(iso.to);
    const groups = new Map<
      string,
      { key: string; title: string; count: number; data: typeof items }
    >();
    for (const event of items) {
      const showingRows =
        ((event as { occasions?: EventOccasion[] }).occasions?.length ?? 0) > 0
          ? ((event as { occasions?: EventOccasion[] }).occasions ?? [])
              .filter((occasion: EventOccasion) => {
                const start = new Date(occasion.startsAt);
                const end = new Date(occasion.endsAt);
                return end >= rangeStart && start <= rangeEnd;
              })
              .map((occasion: EventOccasion) => ({
                ...event,
                startsAt: occasion.startsAt,
                endsAt: occasion.endsAt,
                venueName: occasion.venueName ?? event.venueName,
                location: occasion.location ?? event.location,
              }))
          : [event];
      for (const showing of showingRows) {
        const when = shownWhen(showing, now);
        const stamp = partsInZone(new Date(when.startsAt), showing.timezone);
        const key = `${stamp.y}-${stamp.m}-${stamp.d}`;
        const section = groups.get(key);
        if (section) {
          section.data.push(showing);
          section.count += 1;
        } else {
          groups.set(key, {
            key,
            title: formatSectionTitle(stamp, locale),
            count: 1,
            data: [showing],
          });
        }
      }
    }
    return [...groups.values()];
  }, [events.data, iso.from, iso.to, locale]);

  const filterLabels = useMemo(() => {
    const labels: string[] = [];
    for (const group of groupHomeTags(tags.data?.items ?? [])) {
      const ids = group.tags.map((tag) => tag.id);
      if (ids.length > 0 && ids.every((id) => listedTagIds.includes(id))) {
        labels.push(t(`events.tagGroup.${group.id}`));
      }
    }
    if (shownQuick === 'today') labels.push(t('events.calendar.today'));
    if (shownQuick === 'tomorrow') labels.push(t('events.calendar.tomorrow'));
    if (shownQuick === 'weekend') labels.push(t('events.calendar.weekend'));
    if (shownQuick === 'custom' && shownCustom) {
      labels.push(formatRangeShort(shownCustom.from, shownCustom.to, locale));
    }
    if (price === 'free') labels.push(t('events.free'));
    if (price === 'paid') labels.push(t('events.pricePaid'));
    return labels;
  }, [listedTagIds, locale, price, shownCustom, shownQuick, t, tags.data?.items]);

  const weekend = weekendStamps(today);
  const quickChips = [
    {
      id: 'today' as const,
      title: t('events.calendar.today'),
      detail: formatDayShort(today, locale),
    },
    {
      id: 'tomorrow' as const,
      title: t('events.calendar.tomorrow'),
      detail: formatDayShort(addDays(today, 1), locale),
    },
    {
      id: 'weekend' as const,
      title: t('events.calendar.weekend'),
      detail: formatRangeShort(weekend.from, weekend.to, locale),
    },
  ];

  const savedPlaces = (preferences.data?.areas ?? []).flatMap((area) => {
    if (!queryPointForArea(area) || !area.name.trim()) return [];
    return [{ id: area.id, label: area.name }];
  });
  const radiusByPlace = useMemo(
    () =>
      radiiForPlaces(radiusMap, preferences.data?.areas ?? [], preferences.data?.discoveryRadiusM),
    [preferences.data?.areas, preferences.data?.discoveryRadiusM, radiusMap],
  );
  const locationOptions = [
    { id: NEARBY_PLACE_ID, label: t('events.locationNearby') },
    ...savedPlaces,
  ];
  const locationLabel =
    locationOptions.find((option) => option.id === placeId)?.label ?? t('events.locationNearby');
  const locationDetail = nearbyLocationDetail(placeId, nearbyName.data);

  function toggleSave(eventId: string) {
    if (!identity.data) return;
    const next = savedIds.has(eventId)
      ? unsaveEvent(identity.data, eventId)
      : saveEvent(identity.data, eventId);
    void next.then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }));
  }

  async function refreshCalendar() {
    setRefreshing(true);
    try {
      await Promise.all([
        events.refetch(),
        tags.refetch(),
        ...(identity.isSuccess ? [saved.refetch()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  function chooseQuick(id: QuickDateId) {
    if (id === 'custom') {
      setDateOpen(true);
      return;
    }
    setQuick((current) => (current === id ? null : id));
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <SectionList
        style={{ width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(item) => `${item.id}:${item.startsAt}:${item.endsAt}`}
        stickySectionHeadersEnabled={false}
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refreshCalendar();
            }}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: BottomTabInset + space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
            <View
              style={{
                paddingHorizontal: space.xl,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.md,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <LocationMenu
                  eyebrow={t('tabs.events')}
                  locationLabel={locationLabel}
                  locationDetail={locationDetail}
                  title={t('events.locationPickerTitle')}
                  message={t('events.locationPickerMessage')}
                  options={locationOptions}
                  selectedId={placeId}
                  radiusM={radiusM}
                  radiusByPlace={radiusByPlace}
                  onRadiusChange={saveDiscoveryRadius}
                  isPresented={locationOpen}
                  onIsPresentedChange={setLocationOpen}
                  canAdd={canAddSavedArea(preferences.data?.areas.length ?? 0)}
                  onCreatePlace={areaTags.createFromPlace}
                  onDraftChange={setLocationDraft}
                  eventCount={locationEventCount}
                  onSelect={setDiscoveryPlaceId}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <CircleIconButton
                  plain
                  sf="map"
                  md="map"
                  accessibilityLabel={t('tabs.map')}
                  onPress={() => router.push('/map')}
                  tintColor={colors.accentDeep}
                  style={{ backgroundColor: colors.accentSoft, borderRadius: radius.pill }}
                />
              </View>
            </View>
            <View style={{ paddingHorizontal: space.xl }}>
              <CalendarFilterBar
                active={filterLabels.length > 0}
                title={
                  filterLabels.length > 0
                    ? t('events.calendar.filtersActive', { count: filterLabels.length })
                    : t('events.calendar.filters')
                }
                detail={
                  filterLabels.length > 0
                    ? filterLabels.join(' · ')
                    : t('events.calendar.filtersHint')
                }
                onPress={() => setFiltersOpen(true)}
              />
            </View>
            <View style={{ paddingHorizontal: space.xl }}>
              <MonthStrip
                year={shownMonth.y}
                month={shownMonth.m}
                earliest={{ y: today.y, m: today.m }}
                locale={locale}
                yearLabel={t('events.calendar.year')}
                onYear={(year) => {
                  setMonth((current) => {
                    if (year === today.y && current.m < today.m) return { y: year, m: today.m };
                    return { ...current, y: year };
                  });
                  setQuick(null);
                }}
                onMonth={(year, next) => {
                  setMonth({ y: year, m: next });
                  setQuick(null);
                }}
              />
            </View>
            <View style={{ paddingHorizontal: space.xl }}>
              <QuickDates chips={quickChips} selected={shownQuick} onSelect={chooseQuick} />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              paddingHorizontal: space.xl,
              paddingTop: space.md,
              paddingBottom: space.sm,
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: space.md,
            }}
          >
            <AppText variant="subtitle" style={{ flex: 1 }}>
              {section.title}
            </AppText>
            <AppText variant="caption">
              {t('events.calendar.eventCount', { count: section.count })}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => {
          const when = shownWhen(item, new Date());
          const whole = isWholeDay(when.startsAt, when.endsAt);
          const amount = item.priceAmount;
          const priceLabel = amount != null && amount > 0 ? krPriceLabel(amount) : t('events.free');
          const where =
            item.mode === 'physical'
              ? (item.venueName ?? item.publisherName ?? t('events.missingVenue'))
              : (item.publisherName ?? t('events.missingUrl'));
          const startLabel = whole ? t('events.wholeDay') : clock(when.startsAt, locale);
          const endLabel = whole ? undefined : `${clock(when.endsAt, locale)}`;
          const tagNames = namesForTagIds(item.tagIds, tags.data?.items);
          return (
            <View style={{ paddingHorizontal: space.xl, paddingBottom: space.sm }}>
              {item.sponsored && item.posterUrl ? (
                <SponsoredEventCard
                  title={item.title}
                  posterUrl={item.posterUrl}
                  saved={savedIds.has(item.id)}
                  onSavePress={() => toggleSave(item.id)}
                  onPress={() => router.push(`/events/${item.id}`)}
                />
              ) : (
                <CalendarEventRow
                  title={item.title}
                  where={where}
                  startLabel={startLabel}
                  endLabel={endLabel}
                  tags={tagNames}
                  priceLabel={priceLabel}
                  imageUrl={item.imageUrl}
                  sponsoredLabel={item.sponsored ? t('events.sponsored') : undefined}
                  saved={savedIds.has(item.id)}
                  saveLabel={savedIds.has(item.id) ? t('events.unfavorite') : t('events.favorite')}
                  onSavePress={() => toggleSave(item.id)}
                  onPress={() => router.push(`/events/${item.id}`)}
                />
              )}
            </View>
          );
        }}
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <AppText variant="caption" style={{ textAlign: 'center', padding: space.md }}>
              {t('events.loadingMore')}
            </AppText>
          ) : undefined
        }
        ListEmptyComponent={
          events.isPending ? (
            <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
          ) : (
            <AppText variant="body" style={{ paddingHorizontal: space.xl }}>
              {events.isError ? t('events.loadError') : t('events.empty')}
            </AppText>
          )
        }
      />

      <CalendarFilterSheet
        isPresented={filtersOpen}
        tags={tags.data?.items ?? []}
        tagIds={listedTagIds}
        price={price}
        point={point.data}
        from={iso.from}
        to={iso.to}
        onDismiss={() => setFiltersOpen(false)}
        onApply={(nextTags, nextPrice) => {
          setTagIds(nextTags);
          setPrice(nextPrice);
          setFiltersOpen(false);
        }}
      />
      <CalendarDateSheet
        isPresented={dateOpen}
        today={today}
        locale={locale}
        point={point.data}
        tagIds={listedTagIds}
        price={price === 'any' ? undefined : price}
        initial={shownQuick === 'custom' ? shownCustom : null}
        onDismiss={() => setDateOpen(false)}
        onApply={(next) => {
          setCustom(next);
          setQuick('custom');
          setMonth({ y: next.from.y, m: next.from.m });
          setDateOpen(false);
        }}
      />
      <AreaTagGroupsSheet
        name={areaTags.target?.name ?? ''}
        isPresented={areaTags.target != null}
        busy={areaTags.busy}
        onSave={(ids) => {
          void areaTags.save(ids);
        }}
        onSkip={() => {
          void areaTags.skip();
        }}
        onDismiss={areaTags.dismiss}
      />
    </View>
  );
}

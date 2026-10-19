import { canAddSavedArea, krPriceLabel } from '@local-events/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';

import { AreaTagGroupsSheet } from '@/components/native/area-tag-groups-sheet';
import { LocationMenu } from '@/components/native/location-menu';
import { CalendarEventRow } from '@/components/calendar/calendar-event-row';
import { CalendarDateSheet } from '@/components/calendar/date-sheet';
import { CalendarFilterBar } from '@/components/calendar/filter-bar';
import { CalendarFilterSheet } from '@/components/calendar/filter-sheet';
import { MonthStrip } from '@/components/calendar/month-strip';
import { QuickDates, type QuickDateId } from '@/components/calendar/quick-dates';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { queryPointForArea } from '@/lib/area-point';
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
import { listTags, namesForTagIds } from '@/lib/events';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { useSaveDiscoveryRadius } from '@/lib/save-discovery-radius';
import { groupHomeTags } from '@/lib/tag-groups';
import { useAreaTagPrompt } from '@/lib/use-area-tag-prompt';
import {
  NEARBY_PLACE_ID,
  radiiForPlaces,
  setDiscoveryPlaceId,
  useDiscoveryPoint,
} from '@/lib/use-discovery-point';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Range = { from: DayStamp; to: DayStamp };
type Price = 'any' | 'free' | 'paid';

function clock(iso: string, locale: string) {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export default function EventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const today = useMemo(() => partsInZone(new Date()), []);
  const [month, setMonth] = useState({ y: today.y, m: today.m });
  const [quick, setQuick] = useState<QuickDateId | null>(null);
  const [custom, setCustom] = useState<Range | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [price, setPrice] = useState<Price>('any');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { identity, preferences, point, placeId, radiusM, radiusMap } = useDiscoveryPoint();
  const saveDiscoveryRadius = useSaveDiscoveryRadius(identity.data);
  const areaTags = useAreaTagPrompt(identity.data);
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

  const range = useMemo<Range>(() => {
    if (quick === 'today') return { from: today, to: today };
    if (quick === 'tomorrow') {
      const day = addDays(today, 1);
      return { from: day, to: day };
    }
    if (quick === 'weekend') return weekendStamps(today);
    if (quick === 'custom' && custom) return custom;
    return monthStamps(month.y, month.m);
  }, [custom, month.m, month.y, quick, today]);
  const iso = boundsIso(range.from, range.to);
  const tagKey = [...tagIds].sort().join('\n');
  const events = useInfinitePublicEvents(
    point.data,
    {
      from: iso.from,
      to: iso.to,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      price: price === 'any' ? undefined : price,
      sort: 'soonest',
    },
    ['browse-events', point.data, iso.from, iso.to, tagKey, price],
  );
  const sections = useMemo(() => {
    const items = events.data?.pages.flatMap((page) => page.items) ?? [];
    const now = new Date();
    const groups = new Map<
      string,
      { key: string; title: string; count: number; data: typeof items }
    >();
    for (const event of items) {
      const when = shownWhen(event, now);
      const stamp = partsInZone(new Date(when.startsAt), event.timezone);
      const key = `${stamp.y}-${stamp.m}-${stamp.d}`;
      const section = groups.get(key);
      if (section) {
        section.data.push(event);
        section.count += 1;
      } else {
        groups.set(key, {
          key,
          title: formatSectionTitle(stamp, locale),
          count: 1,
          data: [event],
        });
      }
    }
    return [...groups.values()];
  }, [events.data, locale]);

  const filterLabels = useMemo(() => {
    const labels: string[] = [];
    for (const group of groupHomeTags(tags.data?.items ?? [])) {
      const ids = group.tags.map((tag) => tag.id);
      if (ids.length > 0 && ids.every((id) => tagIds.includes(id))) {
        labels.push(t(`events.tagGroup.${group.id}`));
      }
    }
    if (quick === 'today') labels.push(t('events.calendar.today'));
    if (quick === 'tomorrow') labels.push(t('events.calendar.tomorrow'));
    if (quick === 'weekend') labels.push(t('events.calendar.weekend'));
    if (quick === 'custom' && custom) labels.push(formatRangeShort(custom.from, custom.to, locale));
    if (price === 'free') labels.push(t('events.free'));
    if (price === 'paid') labels.push(t('events.pricePaid'));
    return labels;
  }, [custom, locale, price, quick, t, tagIds, tags.data?.items]);

  const weekend = weekendStamps(today);
  const quickChips = [
    { id: 'today' as const, title: t('events.calendar.today'), detail: formatDayShort(today, locale) },
    {
      id: 'tomorrow' as const,
      title: t('events.calendar.tomorrow'),
      detail: formatDayShort(addDays(today, 1), locale),
    },
    {
      id: 'weekend' as const,
      title: t('events.calendar.weekend'),
      detail: formatRangeShort(weekend.from, weekend.to, locale),
    }
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
        keyExtractor={(item) => item.id}
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
                year={month.y}
                month={month.m}
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
              <QuickDates chips={quickChips} selected={quick} onSelect={chooseQuick} />
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
          return (
            <View style={{ paddingHorizontal: space.xl, paddingBottom: space.sm }}>
              <CalendarEventRow
                title={item.title}
                where={
                  item.mode === 'physical'
                    ? (item.venueName ?? item.publisherName ?? t('events.missingVenue'))
                    : (item.publisherName ?? t('events.missingUrl'))
                }
                startLabel={whole ? t('events.wholeDay') : clock(when.startsAt, locale)}
                endLabel={whole ? undefined : `${clock(when.endsAt, locale)}`}
                tags={namesForTagIds(item.tagIds, tags.data?.items)}
                priceLabel={priceLabel}
                imageUrl={item.imageUrl}
                saved={savedIds.has(item.id)}
                saveLabel={savedIds.has(item.id) ? t('events.unfavorite') : t('events.favorite')}
                onSavePress={() => toggleSave(item.id)}
                onPress={() => router.push(`/events/${item.id}`)}
              />
            </View>
          );
        }}
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <AppText variant="caption" style={{ textAlign: 'center', padding: space.md }}>
              {t('events.loadingMore')}
            </AppText>
          ) : null
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
        tagIds={tagIds}
        price={price}
        onDismiss={() => setFiltersOpen(false)}
        onApply={(nextTags, nextPrice) => {
          setTagIds(nextTags);
          setPrice(nextPrice);
          setFiltersOpen(false);
        }}
      />
      <CalendarDateSheet
        isPresented={dateOpen}
        locale={locale}
        point={point.data}
        tagIds={tagIds}
        price={price === 'any' ? undefined : price}
        initial={quick === 'custom' ? custom : null}
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

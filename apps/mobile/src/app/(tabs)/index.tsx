import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';

import { LocationMenu } from '@/components/native/location-menu';
import { NotificationsSheet } from '@/components/native/notifications-sheet';
import { PairingSheet, type PairingSheetTab } from '@/components/native/pairing-sheet';
import { RegionSuggestionSheet } from '@/components/native/region-suggestion-sheet';
import { AppText } from '@/components/ui/app-text';
import { EventCard } from '@/components/ui/event-card';
import { EventListItem } from '@/components/ui/event-list-item';
import { SearchBar } from '@/components/ui/search-bar';
import { TagFilters } from '@/components/ui/tag-filters';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { api, throwIfError } from '@/lib/api';
import { listPublicEvents, listTags, namesForTagIds } from '@/lib/events';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { loadStoredIdentity, refreshIdentitySession } from '@/lib/identity';
import { listNotifications } from '@/lib/notifications';
import { queryPointForArea } from '@/lib/area-point';
import { refreshDeviceLocation } from '@/lib/device-location';
import { NEARBY_PLACE_ID, setDiscoveryPlaceId, useDiscoveryPoint } from '@/lib/use-discovery-point';
import {
  acceptRegionSuggestion,
  bumpRegionActivity,
  evaluateRegionSuggestion,
  recordRegionDecline,
  type RegionSuggestion,
} from '@/lib/region-suggestion';
import { shouldReevaluateRegionSuggestion } from '@/lib/foreground-location';
import { dateBadge } from '@/lib/event-format';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';

  const [tagId, setTagId] = useState('all');
  const [locationOpen, setLocationOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingTab, setPairingTab] = useState<PairingSheetTab>('web');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);
  const [pairingPending, setPairingPending] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [regionSuggestion, setRegionSuggestion] = useState<RegionSuggestion | null>(null);
  const [regionSheetOpen, setRegionSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { identity, preferences, point, placeId, device } = useDiscoveryPoint();
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: () => listTags(),
  });
  const events = useInfinitePublicEvents(
    point.data,
    { tagId: tagId === 'all' ? undefined : tagId, sort: 'soonest' },
    ['public-events', point.data?.lat, point.data?.lng, point.data?.radiusM, tagId],
  );
  const preferredTagIds = preferences.data?.tagIds ?? [];
  const forYou = useQuery({
    queryKey: ['for-you', point.data?.lat, point.data?.lng, point.data?.radiusM, preferredTagIds],
    enabled: point.isSuccess && preferredTagIds.length > 0,
    queryFn: () =>
      listPublicEvents(point.data!, { tagIds: preferredTagIds, limit: 12, sort: 'soonest' }),
  });
  const forYouItems = forYou.data?.items ?? [];
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = new Set((saved.data?.items ?? []).map((item) => item.id));
  const savedIdKey = useMemo(
    () => (saved.data?.items ?? []).map((item) => item.id).join('\n'),
    [saved.data],
  );
  const inbox = useQuery({
    queryKey: ['notifications', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listNotifications(identity.data!),
    refetchInterval: notificationsOpen ? 15_000 : false,
  });

  useEffect(() => {
    void bumpRegionActivity();
  }, []);

  const lastRegionEval = useRef<{
    lat: number;
    lng: number;
    check: number;
    areasKey: string;
    language: string;
    travelDistanceM: number;
  } | null>(null);

  useEffect(() => {
    if (!identity.isSuccess || !preferences.isSuccess) return;
    const fix = device.fix;
    if (!fix?.located) return;
    const areasKey = (preferences.data?.areas ?? []).map((area) => area.id).join('\n');
    const travelDistanceM = preferences.data?.travelDistanceM ?? 25_000;
    const previous = lastRegionEval.current;
    const foregroundCheckChanged = previous != null && previous.check !== device.check;
    const contextChanged =
      previous != null &&
      (previous.areasKey !== areasKey ||
        previous.language !== i18n.language ||
        previous.travelDistanceM !== travelDistanceM);
    if (
      !contextChanged &&
      !shouldReevaluateRegionSuggestion(
        previous ? { lat: previous.lat, lng: previous.lng } : null,
        fix,
        foregroundCheckChanged,
      )
    ) {
      return;
    }
    const savedAreas = (preferences.data.areas ?? []).flatMap((area) => {
      const queryPoint = queryPointForArea(area);
      return queryPoint
        ? [{ center: { lat: queryPoint.lat, lng: queryPoint.lng }, radiusM: queryPoint.radiusM }]
        : [];
    });
    let cancelled = false;
    void (async () => {
      try {
        const suggestion = await evaluateRegionSuggestion({
          savedAreas,
          fallbackName: t('events.locationHere'),
          location: { lat: fix.lat, lng: fix.lng },
          travelDistanceM,
        });
        if (cancelled) return;
        lastRegionEval.current = {
          lat: fix.lat,
          lng: fix.lng,
          check: device.check,
          areasKey,
          language: i18n.language,
          travelDistanceM,
        };
        if (suggestion) {
          setRegionSuggestion(suggestion);
          setRegionSheetOpen(true);
        }
      } catch {
        // Ignore suggestion failures (permission, network).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    identity.isSuccess,
    preferences.isSuccess,
    preferences.data?.areas,
    preferences.data?.travelDistanceM,
    device.fix,
    device.check,
    i18n.language,
    t,
  ]);

  const { featured, coming } = useMemo(() => {
    const items = events.data?.pages.flatMap((page) => page.items) ?? [];
    return {
      featured: items.filter((event) => event.featured),
      coming: items.filter((event) => !event.featured),
    };
  }, [events.data]);

  async function generatePairingCode() {
    setPairingPending(true);
    setPairingError(null);
    setPairingNotice(null);
    try {
      const stored = await loadStoredIdentity();
      if (!stored) throw new Error('missing_identity');
      const body =
        pairingTab === 'link'
          ? throwIfError(
              await api.POST('/pairing/device-link/code', {
                body: { deviceCredential: stored.deviceCredential },
              }),
            )
          : throwIfError(
              await api.POST('/pairing/code', {
                body: { deviceCredential: stored.deviceCredential },
              }),
            );
      setPairingCode(body.code);
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('events.pairingGenerateError'));
    } finally {
      setPairingPending(false);
    }
  }

  async function confirmDeviceLink() {
    setPairingPending(true);
    setPairingError(null);
    setPairingNotice(null);
    try {
      const stored = await loadStoredIdentity();
      if (!stored) throw new Error('missing_identity');
      throwIfError(
        await api.POST('/pairing/device-link/confirm', {
          body: {
            deviceCredential: stored.deviceCredential,
            code: confirmCode.trim(),
          },
        }),
      );
      await refreshIdentitySession();
      await identity.refetch();
      setConfirmCode('');
      setPairingCode(null);
      setPairingNotice(t('events.pairingConfirmSuccess'));
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('events.pairingConfirmError'));
    } finally {
      setPairingPending(false);
    }
  }

  async function refreshAfterDeviceLink() {
    setPairingPending(true);
    setPairingError(null);
    setPairingNotice(null);
    try {
      const before = await loadStoredIdentity();
      if (!before) throw new Error('missing_identity');
      const after = await refreshIdentitySession();
      await identity.refetch();
      if (after.userId !== before.userId) {
        setPairingNotice(t('events.pairingRefreshSuccess'));
        setPairingCode(null);
      } else {
        setPairingNotice(t('events.pairingRefreshPending'));
      }
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : t('events.pairingConfirmError'));
    } finally {
      setPairingPending(false);
    }
  }

  function toggleSave(eventId: string) {
    if (!identity.data) return;
    const next = savedIds.has(eventId)
      ? unsaveEvent(identity.data, eventId)
      : saveEvent(identity.data, eventId);
    void next.then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }));
  }

  async function refreshHome() {
    setRefreshing(true);
    try {
      await refreshDeviceLocation();
      await Promise.all([identity.refetch(), point.refetch(), events.refetch(), forYou.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const savedPlaces = (preferences.data?.areas ?? []).flatMap((area) => {
    if (!queryPointForArea(area) || !area.name.trim()) return [];
    return [{ id: area.id, label: area.name }];
  });
  const locationOptions = [
    { id: NEARBY_PLACE_ID, label: t('events.locationNearby') },
    ...savedPlaces,
  ];
  const locationLabel =
    locationOptions.find((option) => option.id === placeId)?.label ?? t('events.locationNearby');

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        data={coming}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void refreshHome();
            }}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: BottomTabInset + space.xxxl,
          gap: space.lg,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingTop: space.sm }}>
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
              <View style={{ flexShrink: 1, minWidth: 0, marginLeft: 'auto', maxWidth: '58%' }}>
                <LocationMenu
                  // eyebrow={t('events.currentLocation')}
                  locationLabel={locationLabel}
                  title={t('events.locationPickerTitle')}
                  message={t('events.locationPickerMessage')}
                  options={locationOptions}
                  isPresented={locationOpen}
                  onIsPresentedChange={setLocationOpen}
                  onSelect={(id) => {
                    setDiscoveryPlaceId(id);
                  }}
                />
              </View>
            </View>

            <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
              <SearchBar
                value=""
                onChangeText={() => {}}
                placeholder={t('events.searchPlaceholder')}
                onPress={() =>
                  router.navigate({
                    pathname: '/(tabs)/search',
                    params: { focus: String(Date.now()) },
                  })
                }
              />
            </View>

            <TagFilters tags={tags.data?.items ?? []} selectedId={tagId} onSelect={setTagId} />

            {forYouItems.length > 0 ? (
              <View style={{ gap: space.md }}>
                <View
                  style={{
                    paddingHorizontal: space.xl,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <AppText variant="subtitle">{t('events.forYou')}</AppText>
                  <Pressable accessibilityRole="button" onPress={() => router.push('/for-you')}>
                    <AppText variant="label" style={{ color: colors.info }}>
                      {t('events.viewAll')}
                    </AppText>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: space.md, paddingHorizontal: space.xl }}
                >
                  {forYouItems.map((item) => (
                    <View key={item.id} style={{ width: 280 }}>
                      <EventCard
                        title={item.title}
                        when={new Date(item.startsAt).toLocaleString(locale)}
                        where={
                          item.mode === 'physical'
                            ? (item.venueName ?? t('events.missingVenue'))
                            : (item.onlineUrl ?? t('events.missingUrl'))
                        }
                        tags={namesForTagIds(item.tagIds, tags.data?.items)}
                        imageUrl={item.imageUrl}
                        priceAmount={item.priceAmount}
                        dateBadge={dateBadge(item.startsAt, locale)}
                        saved={savedIds.has(item.id)}
                        onSavePress={() => toggleSave(item.id)}
                        onPress={() => router.push(`/events/${item.id}`)}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {featured.length > 0 ? (
              <View style={{ gap: space.md }}>
                <View
                  style={{
                    paddingHorizontal: space.xl,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <AppText variant="subtitle">{t('events.featuredSection')}</AppText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/(tabs)/events')}
                  >
                    <AppText variant="label" style={{ color: colors.info }}>
                      {t('events.seeAll')}
                    </AppText>
                  </Pressable>
                </View>
                {featured.map((item) => (
                  <View key={item.id} style={{ paddingHorizontal: space.xl }}>
                    <EventCard
                      title={item.title}
                      when={new Date(item.startsAt).toLocaleString(locale)}
                      where={
                        item.mode === 'physical'
                          ? (item.venueName ?? t('events.missingVenue'))
                          : (item.onlineUrl ?? t('events.missingUrl'))
                      }
                      tags={namesForTagIds(item.tagIds, tags.data?.items)}
                      imageUrl={item.imageUrl}
                      priceAmount={item.priceAmount}
                      dateBadge={dateBadge(item.startsAt, locale)}
                      saved={savedIds.has(item.id)}
                      onSavePress={() => toggleSave(item.id)}
                      onPress={() => router.push(`/events/${item.id}`)}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {coming.length > 0 ? (
              <AppText variant="subtitle" style={{ paddingHorizontal: space.xl }}>
                {t('events.coming')}
              </AppText>
            ) : null}

            {identity.isPending && (
              <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
                {t('home.identityLoading')}
              </AppText>
            )}
            {identity.isError && (
              <AppText
                variant="caption"
                style={{ paddingHorizontal: space.xl, color: colors.danger }}
              >
                {t('home.identityError')}
              </AppText>
            )}
            {events.isError && (
              <AppText
                variant="caption"
                style={{ paddingHorizontal: space.xl, color: colors.danger }}
              >
                {t('events.loadError')}
              </AppText>
            )}
          </View>
        }
        extraData={savedIdKey}
        ListFooterComponent={
          events.isFetchingNextPage ? (
            <AppText variant="caption" style={{ paddingHorizontal: space.xl, textAlign: 'center' }}>
              {t('events.loadingMore')}
            </AppText>
          ) : null
        }
        ListEmptyComponent={
          events.isPending && !events.data ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
            </View>
          ) : events.isSuccess && !events.isPlaceholderData && featured.length === 0 ? (
            <AppText variant="body" style={{ paddingHorizontal: space.xl }}>
              {t('events.empty')}
            </AppText>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.xl }}>
            <EventListItem
              title={item.title}
              where={
                item.mode === 'physical'
                  ? (item.venueName ?? t('events.missingVenue'))
                  : (item.onlineUrl ?? t('events.missingUrl'))
              }
              tags={namesForTagIds(item.tagIds, tags.data?.items)}
              imageUrl={item.imageUrl}
              priceAmount={item.priceAmount}
              dateBadge={dateBadge(item.startsAt, locale)}
              onPress={() => router.push(`/events/${item.id}`)}
            />
          </View>
        )}
      />

      <NotificationsSheet
        isPresented={notificationsOpen}
        onDismiss={() => setNotificationsOpen(false)}
        title={t('events.notifications')}
        emptyMessage={t('events.notificationsEmpty')}
        loadingMessage={t('events.notificationsLoading')}
        loading={inbox.isLoading}
        items={(inbox.data?.items ?? []).map((n) => ({
          id: n.id,
          title: n.eventTitle,
          subtitle:
            n.reason === 'publisher'
              ? t('events.notificationReasonPublisher')
              : n.reason === 'event'
                ? t('events.notificationReasonEvent')
                : n.reason === 'broadcast'
                  ? t('events.notificationReasonBroadcast')
                  : t('events.notificationReasonNearby'),
          eventId: n.eventId,
        }))}
        onOpenEvent={(eventId) => {
          setNotificationsOpen(false);
          router.push(`/events/${eventId}`);
        }}
      />

      <PairingSheet
        isPresented={pairingOpen}
        onDismiss={() => setPairingOpen(false)}
        tab={pairingTab}
        onTabChange={(next) => {
          setPairingTab(next);
          setPairingCode(null);
          setPairingError(null);
          setPairingNotice(null);
        }}
        webTabLabel={t('events.pairingWebTab')}
        linkTabLabel={t('events.pairingLinkTab')}
        title={t('events.pairingTitle')}
        hint={pairingTab === 'link' ? t('events.pairingLinkHint') : t('events.pairingHint')}
        code={pairingCode}
        error={pairingError}
        notice={pairingNotice}
        pending={pairingPending}
        generateLabel={t('events.pairingGenerate')}
        generatingLabel={t('events.pairingGenerating')}
        onGenerate={generatePairingCode}
        refreshLabel={t('events.pairingRefreshAfterLink')}
        onRefreshAfterLink={refreshAfterDeviceLink}
        confirmCode={confirmCode}
        onConfirmCodeChange={setConfirmCode}
        confirmLabel={t('events.pairingConfirm')}
        confirmingLabel={t('events.pairingConfirming')}
        onConfirm={confirmDeviceLink}
        confirmHint={t('events.pairingConfirmHint')}
      />

      <RegionSuggestionSheet
        isPresented={regionSheetOpen}
        onIsPresentedChange={setRegionSheetOpen}
        title={t('regions.suggestTitle', { name: regionSuggestion?.name ?? '' })}
        message={t('regions.suggestMessage')}
        saveNotifyLabel={t('regions.saveNotify')}
        saveQuietLabel={t('regions.saveQuiet')}
        notNowLabel={t('regions.notNow')}
        neverLabel={t('regions.never')}
        onSaveNotify={() => {
          if (!identity.data || !regionSuggestion) return;
          void acceptRegionSuggestion(identity.data, regionSuggestion, true).then(() =>
            queryClient.invalidateQueries({ queryKey: ['preferences'] }),
          );
        }}
        onSaveQuiet={() => {
          if (!identity.data || !regionSuggestion) return;
          void acceptRegionSuggestion(identity.data, regionSuggestion, false).then(() =>
            queryClient.invalidateQueries({ queryKey: ['preferences'] }),
          );
        }}
        onNotNow={() => {
          if (!regionSuggestion) return;
          void recordRegionDecline(regionSuggestion, false);
        }}
        onUserDismiss={() => {
          if (!regionSuggestion) return;
          void recordRegionDecline(regionSuggestion, false);
        }}
        onNever={() => {
          if (!regionSuggestion) return;
          void recordRegionDecline(regionSuggestion, true);
        }}
      />
    </View>
  );
}

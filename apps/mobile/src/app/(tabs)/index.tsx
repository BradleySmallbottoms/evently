import { canAddSavedArea } from '@local-events/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AreaTagGroupsSheet } from '@/components/native/area-tag-groups-sheet';
import { LocationMenu } from '@/components/native/location-menu';
import { InboxTipSheet } from '@/components/native/inbox-tip-sheet';
import { NotificationsSheet } from '@/components/native/notifications-sheet';
import { PairingSheet, type PairingSheetTab } from '@/components/native/pairing-sheet';
import { RegionSuggestionSheet } from '@/components/native/region-suggestion-sheet';
import { useReportHomeReady, useSplashDismissed } from '@/components/splash-cover';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { SearchBar } from '@/components/ui/search-bar';
import { HomeCategories } from './_components/home-categories';
import { HomeFeatured } from './_components/home-featured';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { api, throwIfError } from '@/lib/api';
import { listTags, namesForTagIds } from '@/lib/events';
import { useInfinitePublicEvents } from '@/lib/use-public-events';
import { pickHomeFeaturedEvents } from '@/lib/home-featured';
import { isHomeListReady } from '@/lib/home-splash';
import { loadHomeTagIds, saveHomeTagIds } from '@/lib/home-tag-selection';
import { retainedTagIds } from '@/lib/tag-groups';
import { loadStoredIdentity, refreshIdentitySession } from '@/lib/identity';
import { listNotifications } from '@/lib/notifications';
import { openInboxItem, type InboxTipTarget } from '@/lib/open-inbox-item';
import { queryPointForArea } from '@/lib/area-point';
import { pointForPlace, tagsForLocationDraft } from '@/lib/location-draft';
import { useEventCount } from '@/lib/use-event-count';
import { refreshDeviceLocation } from '@/lib/device-location';
import {
  NEARBY_PLACE_ID,
  radiiForPlaces,
  setDiscoveryPlaceId,
  useDiscoveryPoint,
} from '@/lib/use-discovery-point';
import { nearbyLocationDetail } from '@/lib/nearby-place-name';
import { useNearbyPlaceName } from '@/lib/use-nearby-place-name';
import {
  acceptRegionSuggestion,
  bumpRegionActivity,
  evaluateRegionSuggestion,
  recordRegionDecline,
  type RegionSuggestion,
} from '@/lib/region-suggestion';
import {
  shouldHoldRegionSuggestion,
  shouldPresentRegionSheet,
  shouldReevaluateRegionSuggestion,
} from '@/lib/foreground-location';
import { useOnboardingVisible } from '@/lib/onboarding-visibility';
import { eventPlaceLabel, relativeDateLabel } from '@/lib/event-format';
import { shownWhen } from '@/lib/span-occasions';
import { useHasUnreadNotifications } from '@/lib/use-unread-notifications';
import { listSavedEvents, saveEvent, unsaveEvent } from '@/lib/library';
import { updateAreaTags } from '@/lib/preferences';
import { useSaveDiscoveryRadius } from '@/lib/save-discovery-radius';
import { cacheAreaTags, useAreaTagPrompt } from '@/lib/use-area-tag-prompt';
import { ThemedScreen } from '@/components/themed-screen';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const onboardingVisible = useOnboardingVisible();
  const splashDone = useSplashDismissed();
  const locale = i18n.language === 'en' ? 'en' : 'sv';

  const [locationOpen, setLocationOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState<{ placeId: string; radiusM: number } | null>(
    null,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [inboxTip, setInboxTip] = useState<InboxTipTarget | null>(null);
  const pendingInboxTip = useRef<InboxTipTarget | null>(null);
  const pendingThankYou = useRef<`/tips/published/${string}` | null>(null);
  const followUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationsOpenRef = useRef(false);
  useEffect(() => {
    notificationsOpenRef.current = notificationsOpen;
  }, [notificationsOpen]);
  useEffect(() => {
    return () => {
      if (followUpTimer.current) clearTimeout(followUpTimer.current);
    };
  }, []);

  function openInboxFollowUp() {
    if (followUpTimer.current) {
      clearTimeout(followUpTimer.current);
      followUpTimer.current = null;
    }
    const href = pendingThankYou.current;
    pendingThankYou.current = null;
    const next = pendingInboxTip.current;
    pendingInboxTip.current = null;
    if (href) router.push(href);
    else if (next) setInboxTip(next);
  }

  function closeNotificationsForFollowUp() {
    notificationsOpenRef.current = false;
    setNotificationsOpen(false);
    if (followUpTimer.current) clearTimeout(followUpTimer.current);
    // onDismiss presents the next screen. This covers a close that never reports dismiss.
    followUpTimer.current = setTimeout(() => openInboxFollowUp(), 400);
  }
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
  const { hasUnread, numUnread } = useHasUnreadNotifications();

  const { identity, preferences, point, placeId, radiusM, radiusMap, device } = useDiscoveryPoint();
  const nearbyName = useNearbyPlaceName(placeId === NEARBY_PLACE_ID ? device.fix : null);
  const saveDiscoveryRadius = useSaveDiscoveryRadius(identity.data);
  const areaTags = useAreaTagPrompt(identity.data);
  const tags = useQuery({
    queryKey: ['tags', 'upcoming', 'place', point.data?.lat, point.data?.lng, point.data?.radiusM],
    enabled: point.isSuccess,
    queryFn: () => listTags({ near: point.data! }),
  });
  const storedTagIds = useQuery({
    queryKey: ['home-tag-ids'],
    queryFn: loadHomeTagIds,
    staleTime: Infinity,
  });
  const [tagDraft, setTagDraft] = useState<string[] | null>(null);
  const activeArea =
    placeId === NEARBY_PLACE_ID
      ? null
      : (preferences.data?.areas ?? []).find((area) => area.id === placeId);
  const rawTagIds =
    tagDraft ?? (activeArea ? (activeArea.tagIds ?? []) : (storedTagIds.data ?? []));
  const knownTagIds = useMemo(
    () => new Set((tags.data?.items ?? []).map((tag) => tag.id)),
    [tags.data],
  );
  // A saved tag missing from the chips cannot be seen or cleared. Leave it out of
  // the list filter so a clear selection shows every event in the radius.
  const tagsSettled = tags.isSuccess || tags.isError;
  const selectedTagIds = tags.isSuccess ? retainedTagIds(rawTagIds, knownTagIds) : rawTagIds;
  const selectedTagKey = [...selectedTagIds].sort().join('\n');
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
  const locationTagIds = useMemo(() => {
    if (!locationDraft) return selectedTagIds;
    const area = (preferences.data?.areas ?? []).find((item) => item.id === locationDraft.placeId);
    return tagsForLocationDraft({
      draftPlaceId: locationDraft.placeId,
      currentPlaceId: placeId,
      nearbyPlaceId: NEARBY_PLACE_ID,
      currentTagIds: selectedTagIds,
      nearbyTagIds: storedTagIds.data ?? [],
      areaTagIds: area?.tagIds ?? [],
    });
  }, [locationDraft, placeId, preferences.data?.areas, selectedTagIds, storedTagIds.data]);
  const locationEventCount = useEventCount(
    locationPoint,
    {
      tagIds: locationTagIds.length > 0 ? locationTagIds : undefined,
    },
    locationOpen,
  );
  const events = useInfinitePublicEvents(
    storedTagIds.isSuccess && tagsSettled ? point.data : undefined,
    {
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      sort: 'soonest',
    },
    ['public-events', point.data?.lat, point.data?.lng, point.data?.radiusM, selectedTagKey],
  );
  const reportHomeReady = useReportHomeReady();
  const homeListReady = isHomeListReady({
    storedTags: storedTagIds.isError ? 'failed' : storedTagIds.isSuccess ? 'ready' : 'pending',
    point: point.isError ? 'failed' : point.isSuccess ? 'ready' : 'pending',
    tags: !tagsSettled ? 'pending' : tags.isError ? 'failed' : 'ready',
    events: events.isError ? 'failed' : events.isSuccess ? 'ready' : 'pending',
  });
  useEffect(() => {
    if (homeListReady) reportHomeReady();
  }, [homeListReady, reportHomeReady]);
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
  const inbox = useQuery({
    queryKey: ['notifications', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listNotifications(identity.data!),
    refetchInterval: notificationsOpen ? 15_000 : false,
  });

  useEffect(() => {
    void bumpRegionActivity();
  }, []);

  useEffect(() => {
    setTagDraft(null);
  }, [placeId]);

  function changeHomeTags(ids: string[]) {
    setTagDraft(ids);
    if (activeArea && identity.data) {
      const notify = ids.length === 0 ? false : undefined;
      cacheAreaTags(queryClient, identity.data.userId, activeArea.id, ids, notify);
      void updateAreaTags(
        identity.data,
        activeArea.id,
        ids,
        notify === undefined ? undefined : { notify },
      );
      return;
    }
    queryClient.setQueryData(['home-tag-ids'], ids);
    void saveHomeTagIds(ids);
  }

  const lastRegionEval = useRef<{
    lat: number;
    lng: number;
    check: number;
    areasKey: string;
    language: string;
    travelDistanceM: number;
  } | null>(null);
  const onboardingAnchor = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (onboardingVisible) {
      if (device.fix?.located) {
        onboardingAnchor.current = { lat: device.fix.lat, lng: device.fix.lng };
      }
      return;
    }
    if (!identity.isSuccess || !preferences.isSuccess) return;
    const fix = device.fix;
    if (!fix?.located) return;
    if (
      shouldHoldRegionSuggestion({
        onboardingVisible,
        anchor: onboardingAnchor.current,
        location: fix,
      })
    ) {
      return;
    }
    onboardingAnchor.current = null;
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
    onboardingVisible,
    identity.isSuccess,
    preferences.isSuccess,
    preferences.data?.areas,
    preferences.data?.travelDistanceM,
    device.fix,
    device.check,
    i18n.language,
    t,
  ]);

  const listedEvents = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );
  const heroItems = useMemo(() => {
    const now = new Date();
    return pickHomeFeaturedEvents(listedEvents).map((item) => {
      const when = shownWhen(item, now);
      return {
        id: item.id,
        title: item.title,
        when: relativeDateLabel(
          when.startsAt,
          locale,
          { today: t('events.dateToday'), tomorrow: t('events.dateTomorrow') },
          now,
          item.timezone,
        ),
        where: eventPlaceLabel({
          mode: item.mode,
          venueName: item.venueName,
          city: item.meta?.address?.city,
          onlineUrl: item.onlineUrl,
          missingVenue: t('events.missingVenue'),
          missingUrl: t('events.missingUrl'),
        }),
        imageUrl: item.imageUrl,
        tags: namesForTagIds(item.tagIds, tags.data?.items),
        featured: true,
      };
    });
  }, [listedEvents, locale, t, tags.data]);

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
    const wasSaved = shownSavedIds.has(eventId);
    setSaveOverride((prev) => ({ ...prev, [eventId]: !wasSaved }));
    const next = wasSaved ? unsaveEvent(identity.data, eventId) : saveEvent(identity.data, eventId);
    void next
      .then(() => queryClient.invalidateQueries({ queryKey: ['saved-events'] }))
      .catch(() => {
        setSaveOverride((prev) => {
          const copy = { ...prev };
          delete copy[eventId];
          return copy;
        });
      });
  }

  async function refreshHome() {
    setRefreshing(true);
    try {
      await refreshDeviceLocation();
      await Promise.all([
        identity.refetch(),
        point.refetch(),
        tags.refetch(),
        events.refetch(),
        queryClient.invalidateQueries({ queryKey: ['category-rail'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

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

  return (
    <ThemedScreen style={{ alignItems: 'center' }}>
      <ScrollView
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
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
          gap: space.xxl,
          paddingTop: space.sm,
        }}
      >
        <View
          style={{
            paddingHorizontal: space.xl,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
          }}
        >
          {/* <AppText style={{ fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 }}>
            {t('home.title')}
          </AppText> */}
          {/* <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}> */}
          <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
            <AppText
              variant="label"
              style={{ fontSize: 12, lineHeight: 20, fontWeight: '400', letterSpacing: -0.6 }}
            >
              {t('home.title')}
            </AppText>
            <LocationMenu
              pin
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
              onSelect={(id) => {
                setDiscoveryPlaceId(id);
              }}
            />
          </View>
          {/* </View> */}
          <CircleIconButton
            sf="bell"
            md="notifications-none"
            badge={hasUnread}
            accessibilityLabel={
              hasUnread
                ? t('events.notificationsNew', { count: numUnread })
                : t('events.notifications')
            }
            onPress={() => setNotificationsOpen(true)}
          />
        </View>

        {identity.isPending ? (
          <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
            {t('home.identityLoading')}
          </AppText>
        ) : null}
        {identity.isError ? (
          <AppText variant="caption" style={{ paddingHorizontal: space.xl, color: colors.danger }}>
            {t('home.identityError')}
          </AppText>
        ) : null}
        {events.isError ? (
          <AppText variant="caption" style={{ paddingHorizontal: space.xl, color: colors.danger }}>
            {t('events.loadError')}
          </AppText>
        ) : null}

        {events.isPending && !events.data ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
          </View>
        ) : (
          <>
            <HomeFeatured items={heroItems} onPress={(id) => router.push(`/events/${id}`)} />
            <View style={{ paddingHorizontal: space.xl }}>
              <SearchBar
                value=""
                onChangeText={() => {}}
                placeholder={t('home.searchPlaceholder')}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/events',
                    params: { focusAt: String(Date.now()) },
                  })
                }
              />
            </View>
            <HomeCategories
              tags={tags.data?.items ?? []}
              selectedIds={rawTagIds}
              onChange={changeHomeTags}
              point={point.data}
              locale={locale}
              savedIds={shownSavedIds}
              onToggleSave={toggleSave}
              onOpen={(id) => router.push(`/events/${id}`)}
              onShowAll={(ids) =>
                router.push({
                  pathname: '/(tabs)/explore',
                  params: { tagIds: ids.join(','), tagAt: String(Date.now()) },
                })
              }
            />
            {events.isSuccess && !events.isPlaceholderData && listedEvents.length === 0 ? (
              <AppText variant="body" style={{ paddingHorizontal: space.xl }}>
                {t('events.empty')}
              </AppText>
            ) : null}
          </>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/tips')}
          style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
        >
          <AppText variant="label" style={{ textAlign: 'center' }}>
            {t('tips.missing')}
          </AppText>
        </Pressable>
      </ScrollView>

      <NotificationsSheet
        isPresented={notificationsOpen}
        onDismiss={() => {
          notificationsOpenRef.current = false;
          setNotificationsOpen(false);
          openInboxFollowUp();
        }}
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
                  : n.reason === 'tip'
                    ? t('events.notificationReasonTip')
                    : t('events.notificationReasonNearby'),
          eventId: n.eventId,
          reason: n.reason,
        }))}
        onOpen={(item) => {
          if (item.reason !== 'tip') {
            notificationsOpenRef.current = false;
            setNotificationsOpen(false);
          }
          void openInboxItem(
            {
              push: (href) => {
                if (href.startsWith('/tips/published/') && notificationsOpenRef.current) {
                  pendingThankYou.current = href as `/tips/published/${string}`;
                  closeNotificationsForFollowUp();
                  return;
                }
                router.push(href);
              },
            },
            locale,
            item,
            (tip) => {
              if (notificationsOpenRef.current) {
                pendingInboxTip.current = tip;
                closeNotificationsForFollowUp();
                return;
              }
              setInboxTip(tip);
            },
          ).then((openedTip) => {
            if (openedTip || pendingThankYou.current || !notificationsOpenRef.current) return;
            notificationsOpenRef.current = false;
            setNotificationsOpen(false);
          });
        }}
      />
      <InboxTipSheet target={inboxTip} onDismiss={() => setInboxTip(null)} />

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
        isPresented={shouldPresentRegionSheet(splashDone, regionSheetOpen)}
        onIsPresentedChange={setRegionSheetOpen}
        title={t('regions.suggestTitle', { name: regionSuggestion?.name ?? '' })}
        message={t('regions.suggestMessage')}
        saveNotifyLabel={t('regions.saveNotify')}
        saveQuietLabel={t('regions.saveQuiet')}
        notNowLabel={t('regions.notNow')}
        neverLabel={t('regions.never')}
        onSaveNotify={() => {
          if (!identity.data || !regionSuggestion) return;
          void acceptRegionSuggestion(identity.data, regionSuggestion, true).then(async (area) => {
            await queryClient.invalidateQueries({ queryKey: ['preferences'] });
            areaTags.promptForArea({ id: area.id, name: area.name });
          });
        }}
        onSaveQuiet={() => {
          if (!identity.data || !regionSuggestion) return;
          void acceptRegionSuggestion(identity.data, regionSuggestion, false).then(async (area) => {
            await queryClient.invalidateQueries({ queryKey: ['preferences'] });
            areaTags.promptForArea({ id: area.id, name: area.name });
          });
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
    </ThemedScreen>
  );
}

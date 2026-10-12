import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { LocationMenu } from '@/components/native/location-menu';
import { NotificationsSheet } from '@/components/native/notifications-sheet';
import {
  PairingSheet,
  type PairingSheetTab,
} from '@/components/native/pairing-sheet';
import { RegionSuggestionSheet } from '@/components/native/region-suggestion-sheet';
import { AppText } from '@/components/ui/app-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { EventCard } from '@/components/ui/event-card';
import { EventListItem } from '@/components/ui/event-list-item';
import { SearchBar } from '@/components/ui/search-bar';
import { TagFilters } from '@/components/ui/tag-filters';
import { BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { api, throwIfError } from '@/lib/api';
import { listPublicEvents, listTags, namesForTagIds } from '@/lib/events';
import { loadStoredIdentity, refreshIdentitySession } from '@/lib/identity';
import { listNotifications } from '@/lib/notifications';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { subscribeSilentPushHandlers } from '@/lib/push-notifications';
import {
  acceptRegionSuggestion,
  bumpRegionActivity,
  evaluateRegionSuggestion,
  recordRegionDecline,
  type RegionSuggestion,
} from '@/lib/region-suggestion';
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
  const [useFallbackCenter, setUseFallbackCenter] = useState(false);
  const [regionSuggestion, setRegionSuggestion] = useState<RegionSuggestion | null>(null);
  const [regionSheetOpen, setRegionSheetOpen] = useState(false);

  const { identity, preferences, point } = useDiscoveryPoint(useFallbackCenter);
  const tags = useQuery({
    queryKey: ['tags', 'upcoming'],
    queryFn: listTags,
  });
  const events = useQuery({
    queryKey: ['public-events', point.data?.lat, point.data?.lng, point.data?.radiusM],
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });
  const saved = useQuery({
    queryKey: ['saved-events', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => listSavedEvents(identity.data!),
  });
  const savedIds = new Set((saved.data?.items ?? []).map((item) => item.id));
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
    return subscribeSilentPushHandlers({
      getQuietHours: () => preferences.data?.quietHours,
      getLocale: () => locale,
      onInboxPing: () => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      },
    });
  }, [preferences.data?.quietHours, locale, queryClient]);

  useEffect(() => {
    if (!identity.isSuccess || !preferences.isSuccess) return;
    const savedAreas = (preferences.data.areas ?? [])
      .filter((a) => a.active && a.center && a.radiusM != null)
      .map((a) => ({ center: a.center!, radiusM: a.radiusM! }));
    let cancelled = false;
    void (async () => {
      try {
        const suggestion = await evaluateRegionSuggestion({ savedAreas });
        if (!cancelled && suggestion) {
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
  }, [identity.isSuccess, preferences.isSuccess, preferences.data?.areas]);

  const { featured, coming } = useMemo(() => {
    const items = events.data?.items ?? [];
    const visible = items.filter((event) => tagId === 'all' || event.tagIds.includes(tagId));
    return {
      featured: visible.filter((event) => event.featured),
      coming: visible.filter((event) => !event.featured),
    };
  }, [events.data?.items, tagId]);

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

  const locationLabel = useFallbackCenter
    ? t('events.locationSoderhamn')
    : t('events.locationNearby');

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        data={coming}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={events.isRefetching || identity.isRefetching}
            onRefresh={() => {
              void identity.refetch();
              void point.refetch();
              void events.refetch();
            }}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{
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
                useNearbyLabel={t('events.useNearby')}
                useFallbackLabel={t('events.useSoderhamn')}
                isPresented={locationOpen}
                onIsPresentedChange={setLocationOpen}
                onUseNearby={() => {
                  setUseFallbackCenter(false);
                  void point.refetch();
                }}
                onUseFallback={() => {
                  setUseFallbackCenter(true);
                  void point.refetch();
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
                  router.navigate({ pathname: '/(tabs)/search', params: { focus: String(Date.now()) } })
                }
              />
            </View>

            <TagFilters tags={tags.data?.items ?? []} selectedId={tagId} onSelect={setTagId} />

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
              <AppText variant="caption" style={{ paddingHorizontal: space.xl, color: colors.danger }}>
                {t('home.identityError')}
              </AppText>
            )}
            {events.isPending && (
              <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
                {t('events.loading')}
              </AppText>
            )}
            {events.isError && (
              <AppText variant="caption" style={{ paddingHorizontal: space.xl, color: colors.danger }}>
                {t('events.loadError')}
              </AppText>
            )}
          </View>
        }
        extraData={{
          savedIds: [...savedIds],
          eventsStatus: events.status,
          identityStatus: identity.status,
        }}
        ListEmptyComponent={
          events.isSuccess && featured.length === 0 ? (
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
        onNever={() => {
          if (!regionSuggestion) return;
          void recordRegionDecline(regionSuggestion, true);
        }}
      />
    </View>
  );
}

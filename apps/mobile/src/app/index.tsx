import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import { DateFilter } from '@/components/native/date-filter';
import { LocationMenu } from '@/components/native/location-menu';
import {
  PairingSheet,
  type PairingSheetTab,
} from '@/components/native/pairing-sheet';
import { AppText } from '@/components/ui/app-text';
import { CategoryChips } from '@/components/ui/category-chips';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { EventCard } from '@/components/ui/event-card';
import { SearchBar } from '@/components/ui/search-bar';
import { MaxContentWidth } from '@/constants/theme';
import { api, throwIfError } from '@/lib/api';
import {
  FALLBACK_CENTER,
  listPublicEvents,
  resolveEventQueryPoint,
  type EventQueryPoint,
} from '@/lib/events';
import {
  ensureIdentity,
  loadStoredIdentity,
  refreshIdentitySession,
} from '@/lib/identity';
import { getPreferences, primaryCircleArea } from '@/lib/preferences';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [filterDate, setFilterDate] = useState(() => new Date());
  const [locationOpen, setLocationOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingTab, setPairingTab] = useState<PairingSheetTab>('web');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);
  const [pairingPending, setPairingPending] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [useFallbackCenter, setUseFallbackCenter] = useState(false);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
    retry: false,
  });
  const savedArea = primaryCircleArea(preferences.data?.areas ?? []);
  const point = useQuery({
    queryKey: [
      'event-query-point',
      useFallbackCenter,
      savedArea?.lat,
      savedArea?.lng,
      savedArea?.radiusM,
    ],
    queryFn: async (): Promise<EventQueryPoint> => {
      if (useFallbackCenter) return { ...FALLBACK_CENTER };
      if (savedArea) return savedArea;
      return resolveEventQueryPoint();
    },
    enabled: identity.isSuccess && !preferences.isLoading,
    retry: false,
  });
  const events = useQuery({
    queryKey: ['public-events', point.data?.lat, point.data?.lng, point.data?.radiusM],
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  const categories = useMemo(
    () => [
      { id: 'all', label: t('events.categoryAll') },
      { id: 'physical', label: t('events.categoryPhysical') },
      { id: 'digital', label: t('events.categoryDigital') },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    const items = events.data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((event) => {
      if (categoryId === 'physical' && event.mode !== 'physical') return false;
      if (categoryId === 'digital' && event.mode !== 'digital') return false;
      if (!q) return true;
      return event.title.toLowerCase().includes(q);
    });
  }, [events.data?.items, search, categoryId]);

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

  const locationLabel = useFallbackCenter
    ? t('events.locationSoderhamn')
    : t('events.locationNearby');

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <FlatList
        style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth }}
        data={filtered}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={events.isFetching && !events.isPending}
            onRefresh={() => void events.refetch()}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{
          paddingBottom: space.xxxl,
          gap: space.lg,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, paddingTop: space.sm }}>
            <View
              style={{
                paddingHorizontal: space.xl,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <LocationMenu
                eyebrow={t('events.currentLocation')}
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
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <CircleIconButton
                  sf="slider.horizontal.3"
                  accessibilityLabel={t('preferences.open')}
                  onPress={() => router.push('/preferences')}
                />
                <CircleIconButton
                  sf="qrcode"
                  accessibilityLabel={t('events.pairingTitle')}
                  onPress={() => setPairingOpen(true)}
                />
                <CircleIconButton
                  sf="bell"
                  badge
                  accessibilityLabel={t('events.notifications')}
                />
              </View>
            </View>

            <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
              <AppText variant="hero">{t('events.listTitle')}</AppText>
              <AppText variant="caption">{t('events.listSubtitle')}</AppText>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={t('events.searchPlaceholder')}
              />
              <DateFilter
                label={t('events.filterDate')}
                value={filterDate}
                onChange={setFilterDate}
              />
            </View>

            <CategoryChips
              items={categories}
              selectedId={categoryId}
              onSelect={setCategoryId}
            />

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
            {(point.isLoading || events.isLoading) && (
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
          favorites,
          eventsStatus: events.status,
          identityStatus: identity.status,
        }}
        ListEmptyComponent={
          events.isSuccess ? (
            <AppText variant="body" style={{ paddingHorizontal: space.xl }}>
              {t('events.empty')}
            </AppText>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.xl }}>
            <EventCard
              title={item.title}
              when={`${new Date(item.startsAt).toLocaleString(locale)}`}
              where={
                item.mode === 'physical'
                  ? `${t('events.venue')}: ${item.venueName ?? t('events.missingVenue')}`
                  : `${t('events.online')}: ${item.onlineUrl ?? t('events.missingUrl')}`
              }
              mode={item.mode}
              favorited={!!favorites[item.id]}
              onFavoritePress={() =>
                setFavorites((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
              }
              onPress={() => router.push(`/events/${item.id}`)}
            />
          </View>
        )}
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
    </View>
  );
}

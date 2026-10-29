import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapEventSheet, type MapEventSelection } from '@/components/native/map-event-sheet';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { FALLBACK_CENTER, listPublicEvents } from '@/lib/events';
import { createMapClusterIndex, markersInRegion, type MapRegion } from '@/lib/map-clusters';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { eventListFreshness } from '@/lib/query-client';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

const OPEN_DELTA = 0.4;

function GroupBadge({ count }: { count: number }) {
  const size = count >= 100 ? 52 : count >= 10 ? 46 : 40;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent,
        borderWidth: 2,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: shadow.hard,
      }}
    >
      <Text
        style={{
          color: colors.ink,
          fontSize: count >= 100 ? 13 : 16,
          lineHeight: count >= 100 ? 16 : 20,
          fontWeight: '700',
        }}
      >
        {count}
      </Text>
    </View>
  );
}

function eventWhen(event: Parameters<typeof shownWhen>[0], locale: string, wholeDay: string) {
  const shown = shownWhen(event, new Date());
  return isWholeDay(shown.startsAt, shown.endsAt)
    ? wholeDay
    : new Date(shown.startsAt).toLocaleString(locale);
}

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<MapEventSelection | null>(null);
  const [trackGroups, setTrackGroups] = useState(true);

  const { point } = useDiscoveryPoint();
  const center = point.data ?? FALLBACK_CENTER;
  const [region, setRegion] = useState<MapRegion>(() => ({
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: OPEN_DELTA,
    longitudeDelta: OPEN_DELTA,
  }));
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    ...eventListFreshness,
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  const located = useMemo(
    () =>
      (events.data?.items ?? [])
        .filter((event) => event.location)
        .map((event) => ({
          event,
          id: event.id,
          lat: event.location!.lat,
          lng: event.location!.lng,
        })),
    [events.data?.items],
  );
  const clusterIndex = useMemo(() => createMapClusterIndex(located), [located]);
  const markers = useMemo(
    () => markersInRegion(clusterIndex, region, width),
    [clusterIndex, region, width],
  );
  const groupKey = markers
    .filter((marker) => marker.kind === 'group')
    .map((marker) => `${marker.id}:${marker.count}`)
    .join('\n');

  useEffect(() => {
    setTrackGroups(true);
    const id = setTimeout(() => setTrackGroups(false), 400);
    return () => clearTimeout(id);
  }, [groupKey]);

  const failed = point.isError || events.isError;
  const loading = !failed && (point.isLoading || events.isLoading);

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: OPEN_DELTA,
          longitudeDelta: OPEN_DELTA,
        }}
        moveOnMarkerPress={false}
        onRegionChangeComplete={(next: Region) => {
          setRegion({
            latitude: next.latitude,
            longitude: next.longitude,
            latitudeDelta: next.latitudeDelta,
            longitudeDelta: next.longitudeDelta,
          });
        }}
      >
        {markers.map((marker) =>
          marker.kind === 'group' ? (
            <Marker
              key={marker.id}
              coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={trackGroups}
              zIndex={marker.count}
              accessibilityLabel={t('events.mapGroup', { count: marker.count })}
              onPress={() => {
                setSelected(null);
                mapRef.current?.animateToRegion(marker.region, 280);
              }}
            >
              <GroupBadge count={marker.count} />
            </Marker>
          ) : (
            <Marker
              key={marker.id}
              coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
              title={marker.point.event.title}
              pinColor={colors.accent}
              onPress={() =>
                setSelected({
                  id: marker.point.event.id,
                  title: marker.point.event.title,
                  when: eventWhen(marker.point.event, locale, t('events.wholeDay')),
                })
              }
            />
          ),
        )}
      </MapView>

      {loading ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + space.sm,
            right: space.xl,
            height: 44,
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
        </View>
      ) : null}
      {failed ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + space.sm + 44 + space.md,
            left: space.xl,
            right: space.xl,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            padding: space.md,
          }}
        >
          <AppText variant="body" style={{ color: colors.danger, textAlign: 'center' }}>
            {t('events.loadError')}
          </AppText>
        </View>
      ) : null}

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + space.sm,
          left: 0,
          width: '100%',
          paddingHorizontal: space.xl,
        }}
      >
        <BackPill />
      </View>

      <MapEventSheet
        selected={selected}
        onDismiss={() => setSelected(null)}
        readMoreLabel={t('events.readMore')}
        onReadMore={(id) => router.push(`/events/${id}`)}
      />
    </View>
  );
}

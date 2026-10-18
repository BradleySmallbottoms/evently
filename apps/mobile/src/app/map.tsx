import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MapEventSheet,
  type MapEventSelection,
} from '@/components/native/map-event-sheet';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { listPublicEvents } from '@/lib/events';
import { isWholeDay, shownWhen } from '@/lib/span-occasions';
import { eventListFreshness } from '@/lib/query-client';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [selected, setSelected] = useState<MapEventSelection | null>(null);

  const { point } = useDiscoveryPoint();
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    ...eventListFreshness,
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  const center = point.data ?? { lat: 61.3037, lng: 17.0592, radiusM: 50_000 };
  const failed = point.isError || events.isError;
  const loading = !failed && (point.isLoading || events.isLoading);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.4,
          longitudeDelta: 0.4,
        }}
      >
        {events.data?.items
          .filter((event) => event.location)
          .map((event) => (
            <Marker
              key={event.id}
              coordinate={{
                latitude: event.location!.lat,
                longitude: event.location!.lng,
              }}
              title={event.title}
              pinColor={colors.accent}
              onPress={() =>
                setSelected({
                  id: event.id,
                  title: event.title,
                  when: (() => {
                    const shown = shownWhen(event, new Date());
                    return isWholeDay(shown.startsAt, shown.endsAt)
                      ? t('events.wholeDay')
                      : new Date(shown.startsAt).toLocaleString(locale);
                  })(),
                })
              }
            />
          ))}
      </MapView>

      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <ActivityIndicator accessibilityLabel={t('events.loading')} color={colors.ink} />
        </View>
      ) : null}
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { padding: space.xl }]}>
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
          left: space.lg,
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

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});

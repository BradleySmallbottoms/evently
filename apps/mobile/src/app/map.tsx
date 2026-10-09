import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import {
  MapEventSheet,
  type MapEventSelection,
} from '@/components/native/map-event-sheet';
import { AppText } from '@/components/ui/app-text';
import { MaxContentWidth } from '@/constants/theme';
import { listPublicEvents, resolveEventQueryPoint } from '@/lib/events';
import { ensureIdentity } from '@/lib/identity';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [selected, setSelected] = useState<MapEventSelection | null>(null);

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
    retry: 1,
  });
  const point = useQuery({
    queryKey: ['event-query-point-map'],
    queryFn: resolveEventQueryPoint,
    enabled: identity.isSuccess,
    retry: false,
  });
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  const center = point.data ?? { lat: 61.3037, lng: 17.0592, radiusM: 50_000 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: MaxContentWidth,
          paddingHorizontal: space.xl,
          paddingTop: space.sm,
          gap: space.md,
        }}
      >
        <AppText variant="hero">{t('events.mapTitle')}</AppText>
        <AppText variant="caption">{t('events.mapSubtitle')}</AppText>

        {(point.isLoading || events.isLoading) && (
          <AppText variant="caption">{t('events.loading')}</AppText>
        )}
        {events.isError && (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {t('events.loadError')}
          </AppText>
        )}

        <View
          style={{
            flex: 1,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            overflow: 'hidden',
            marginBottom: space.xl,
          }}
        >
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
                      when: new Date(event.startsAt).toLocaleString(locale),
                    })
                  }
                />
              ))}
          </MapView>
        </View>
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

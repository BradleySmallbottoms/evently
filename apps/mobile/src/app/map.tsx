import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MapEventSheet,
  type MapEventSelection,
} from '@/components/native/map-event-sheet';
import { AppText } from '@/components/ui/app-text';
import { MaxContentWidth } from '@/constants/theme';
import { listPublicEvents } from '@/lib/events';
import { useDiscoveryPoint } from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const [selected, setSelected] = useState<MapEventSelection | null>(null);

  const { point } = useDiscoveryPoint();
  const events = useQuery({
    queryKey: ['public-events-map', point.data?.lat, point.data?.lng, point.data?.radiusM],
    queryFn: () => listPublicEvents(point.data!),
    enabled: point.isSuccess,
  });

  const center = point.data ?? { lat: 61.3037, lng: 17.0592, radiusM: 50_000 };

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
                  when: new Date(event.startsAt).toLocaleString(locale),
                })
              }
            />
          ))}
      </MapView>

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: Math.max(insets.top, space.md),
          left: 0,
          right: 0,
          alignItems: 'center',
          paddingHorizontal: space.xl,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: MaxContentWidth,
            backgroundColor: colors.card as string,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            paddingHorizontal: space.xl,
            paddingVertical: space.lg,
            gap: space.xs,
            boxShadow: shadow.card,
          }}
        >
          <AppText variant="title">{t('events.mapTitle')}</AppText>
          <AppText variant="caption">{t('events.mapSubtitle')}</AppText>
          {(point.isLoading || events.isLoading) && (
            <AppText variant="caption">{t('events.loading')}</AppText>
          )}
          {events.isError && (
            <AppText variant="caption" style={{ color: colors.danger }}>
              {t('events.loadError')}
            </AppText>
          )}
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

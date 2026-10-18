import { Pressable, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

export type MapPoint = { lat: number; lng: number };

type Props = {
  points: MapPoint[];
  openLabel: string;
  onOpen: () => void;
};

function regionFor(points: MapPoint[]) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.06, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.06, (maxLng - minLng) * 1.8),
  };
}

export function DetailMap({ points, openLabel, onOpen }: Props) {
  if (points.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={openLabel}
      onPress={onOpen}
      style={{
        height: 180,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: colors.infoSoft,
        boxShadow: shadow.card,
      }}
    >
      <MapView
        pointerEvents="none"
        style={{ flex: 1 }}
        initialRegion={regionFor(points)}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        {points.map((point) => (
          <Marker
            key={`${point.lat},${point.lng}`}
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            pinColor={colors.accent as string}
          />
        ))}
      </MapView>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', right: space.md, bottom: space.md }}
      >
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.pill,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
          }}
        >
          <AppText style={{ color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700' }}>
            {openLabel}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

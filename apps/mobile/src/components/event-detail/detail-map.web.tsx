import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

import { DetailGlyph } from './detail-glyph';

export type MapPoint = { lat: number; lng: number };

type Props = {
  points: MapPoint[];
  openLabel: string;
  onOpen: () => void;
};

/** Web has no native map. The card still opens directions. */
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
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <DetailGlyph sf="map" md="map" size={36} color={colors.info as string} />
      <View style={{ position: 'absolute', right: space.md, bottom: space.md }}>
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

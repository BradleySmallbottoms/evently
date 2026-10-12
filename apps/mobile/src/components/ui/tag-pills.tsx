import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const CHIP_COLORS = [colors.secondarySoft, colors.accentSoft, colors.infoSoft] as const;

/** Small colored labels, matching the reference event cards and detail chips. */
export function TagPills({ tags, limit }: { tags: string[]; limit?: number }) {
  const visible = limit == null ? tags : tags.slice(0, limit);
  if (visible.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {visible.map((tag, index) => (
        <View
          key={`${tag}-${index}`}
          style={{
            backgroundColor: CHIP_COLORS[index % CHIP_COLORS.length],
            borderRadius: radius.pill,
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
          }}
        >
          <AppText variant="label" style={{ color: colors.ink }}>
            {tag}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Compact kronor amount, overlaid on the top-right of a title. */
export function PricePill({ label }: { label: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.card as string,
        borderRadius: radius.pill,
        paddingHorizontal: 6,
        paddingVertical: 1,
      }}
    >
      <AppText style={{ color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}

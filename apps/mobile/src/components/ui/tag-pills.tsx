import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const CHIP_COLORS = [colors.secondarySoft, colors.accentSoft, colors.infoSoft] as const;

/** Small colored labels, matching the reference event cards and detail chips. */
export function TagPills({
  tags,
  limit,
  size = 'md',
}: {
  tags: string[];
  limit?: number;
  size?: 'sm' | 'md';
}) {
  const visible = limit == null ? tags : tags.slice(0, limit);
  if (visible.length === 0) return null;
  const small = size === 'sm';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: small ? 6 : space.sm }}>
      {visible.map((tag, index) => (
        <View
          key={`${tag}-${index}`}
          style={{
            flexShrink: 1,
            backgroundColor: CHIP_COLORS[index % CHIP_COLORS.length],
            borderRadius: radius.pill,
            paddingHorizontal: small ? 8 : space.sm,
            paddingVertical: small ? 2 : space.xs,
          }}
        >
          <AppText
            variant="label"
            numberOfLines={1}
            style={{
              color: colors.ink,
              fontSize: small ? 11 : undefined,
              lineHeight: small ? 14 : undefined,
              fontWeight: small ? '400' : undefined,
            }}
          >
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

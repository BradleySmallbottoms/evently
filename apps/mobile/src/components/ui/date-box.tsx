import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow as shadowTokens, space } from '@/theme/tokens';

type Badge = { weekday: string; day: string; month: string };

/** Two rows: weekday, then day and month. Shared by event cards, lists, and the details page. */
export function DateBox({ badge, compact = false, shadow = false }: { badge: Badge; compact?: boolean; shadow?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: colors.card as string,
        borderRadius: compact ? radius.sm : radius.md,
        borderCurve: 'continuous',
        paddingHorizontal: compact ? 6 : space.md,
        paddingVertical: compact ? 3 : space.sm,
        alignItems: 'center',
        boxShadow: shadow ? shadowTokens.hard : undefined,
      }}
    >
      <AppText
        variant="label"
        style={{
          color: colors.inkMuted,
          fontSize: compact ? 9 : 11,
          lineHeight: compact ? 11 : 14,
          textTransform: 'uppercase',
        }}
      >
        {badge.weekday}
      </AppText>
      <AppText
        variant="label"
        style={{
          color: colors.ink,
          fontWeight: '700',
          fontSize: compact ? 11 : undefined,
          lineHeight: compact ? 14 : 18,
          textTransform: 'uppercase',
        }}
      >
        {`${badge.day} ${badge.month}`}
      </AppText>
    </View>
  );
}

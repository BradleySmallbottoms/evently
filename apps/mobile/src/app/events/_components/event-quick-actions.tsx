import { Pressable, View } from 'react-native';

import { DetailGlyph } from './detail-glyph';
import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

type Action = {
  label: string;
  sf: string;
  md: 'event' | 'notifications-none' | 'notifications';
  onPress: () => void;
};

/** Icon and a short label, side by side under the date and place card. */
export function EventQuickActions({ actions }: { actions: Action[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{
            flex: 1,
            minHeight: 64,
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.xs,
            paddingHorizontal: space.sm,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            borderCurve: 'continuous',
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <DetailGlyph sf={action.sf} md={action.md} size={22} color={colors.accent as string} />
          <AppText
            numberOfLines={2}
            style={{
              textAlign: 'center',
              fontSize: 12,
              lineHeight: 16,
              fontWeight: '600',
              color: colors.ink,
            }}
          >
            {action.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

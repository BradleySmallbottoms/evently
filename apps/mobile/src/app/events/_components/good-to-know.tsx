import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

import { DetailGlyph } from './detail-glyph';

export type FactRow = {
  key: string;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  onPress?: () => void;
  accent?: boolean;
};

export function GoodToKnow({ title, rows }: { title: string; rows: FactRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: space.lg }}>
      <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink }}>
        {title}
      </AppText>
      <View style={{ gap: space.sm }}>
        {rows.map((row) => {
          const body = (
            <>
              <DetailGlyph sf={row.sf} md={row.md} size={18} color={colors.inkMuted as string} />
              <AppText variant="caption" style={{ width: 108 }}>
                {row.label}
              </AppText>
              <AppText
                variant="caption"
                numberOfLines={2}
                style={{
                  flex: 1,
                  textAlign: 'right',
                  color: row.accent ? colors.info : colors.ink,
                }}
              >
                {row.value}
              </AppText>
            </>
          );
          const style = {
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            gap: space.md,
            minHeight: 22,
          };
          if (!row.onPress) {
            return (
              <View key={row.key} style={style}>
                {body}
              </View>
            );
          }
          return (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}, ${row.value}`}
              onPress={row.onPress}
              style={style}
            >
              {body}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

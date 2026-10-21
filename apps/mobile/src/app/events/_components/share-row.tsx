import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

import { DetailGlyph } from './detail-glyph';

type Action = {
  key: string;
  label: string;
  onPress: () => void;
  sf?: string;
  md?: keyof typeof MaterialIcons.glyphMap;
  letter?: string;
};

export function ShareRow({ title, actions }: { title: string; actions: Action[] }) {
  return (
    <View style={{ gap: space.lg }}>
      <AppText style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink }}>
        {title}
      </AppText>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={{ flex: 1, alignItems: 'center', gap: space.sm, minHeight: 44 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.pill,
                backgroundColor: colors.canvas,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {action.letter ? (
                <AppText
                  style={{ fontSize: 22, lineHeight: 26, fontWeight: '700', color: colors.ink }}
                >
                  {action.letter}
                </AppText>
              ) : (
                <DetailGlyph
                  sf={action.sf ?? 'square.and.arrow.up'}
                  md={action.md ?? 'share'}
                  size={22}
                />
              )}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ textAlign: 'center' }}>
              {action.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

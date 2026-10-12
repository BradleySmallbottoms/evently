import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

export type CategoryChip = { id: string; label: string };

type Props = {
  items: CategoryChip[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function CategoryChips({ items, selectedId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xl }}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              onSelect(item.id);
            }}
            style={{
              paddingHorizontal: space.lg,
              paddingVertical: space.sm + 2,
              borderRadius: radius.pill,
              borderCurve: 'continuous',
              backgroundColor: selected ? colors.accentSoft : (colors.card as string),
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.line,
            }}
          >
            <AppText variant="label" style={{ color: colors.ink, fontWeight: '600' }}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
      <View style={{ width: space.xs }} />
    </ScrollView>
  );
}

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { space } from '@/theme/tokens';

type Icon = { sf: SFSymbol; md: keyof typeof MaterialIcons.glyphMap };

const RULES: { match: RegExp; icon: Icon }[] = [
  { match: /musik|music|konsert|jazz/, icon: { sf: 'music.note', md: 'music-note' } },
  { match: /teater|theater|scen/, icon: { sf: 'theatermasks', md: 'theater-comedy' } },
  { match: /traning|idrott|sport|lop|bandy|hockey/, icon: { sf: 'figure.run', md: 'directions-run' } },
  { match: /museum/, icon: { sf: 'building.columns', md: 'museum' } },
  { match: /utomhus|natur|friluft|park|skog/, icon: { sf: 'leaf', md: 'park' } },
  { match: /mat|food|restaurang|fika/, icon: { sf: 'fork.knife', md: 'restaurant' } },
  { match: /jul|nyar|hogtid/, icon: { sf: 'gift', md: 'card-giftcard' } },
  { match: /tavling/, icon: { sf: 'trophy', md: 'emoji-events' } },
  { match: /utstall|massa|konst/, icon: { sf: 'paintpalette', md: 'palette' } },
  { match: /barn|familj/, icon: { sf: 'figure.and.child.holdinghands', md: 'child-care' } },
];

const FALLBACK: Icon = { sf: 'tag', md: 'label' };

function iconFor(slug: string, name: string): Icon {
  const key = `${slug} ${name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return RULES.find((rule) => rule.match.test(key))?.icon ?? FALLBACK;
}

type Tag = { id: string; slug: string; name: string };

type Props = {
  tags: Tag[];
  selectedId: string;
  onSelect: (id: string) => void;
};

/** Round icon shortcuts with the tag name underneath, as on the reference home screen. */
export function TagFilters({ tags, selectedId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.lg, paddingHorizontal: space.xl }}
    >
      {tags.map((tag) => {
        const selected = tag.id === selectedId;
        const icon = iconFor(tag.slug, tag.name);
        return (
          <Pressable
            key={tag.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={tag.name}
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              onSelect(selected ? 'all' : tag.id);
            }}
            style={{ width: 76, alignItems: 'center', gap: space.xs }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? (colors.accentSoft as string) : (colors.secondarySoft as string),
                borderWidth: selected ? 2 : 0,
                borderColor: colors.accent,
              }}
            >
              {process.env.EXPO_OS === 'ios' ? (
                <SymbolView name={icon.sf} size={26} tintColor={colors.ink} />
              ) : (
                <MaterialIcons name={icon.md} size={26} color={colors.ink} />
              )}
            </View>
            <AppText
              numberOfLines={2}
              style={{
                textAlign: 'center',
                fontSize: 12,
                lineHeight: 15,
                fontWeight: '600',
                color: colors.ink,
              }}
            >
              {tag.name}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

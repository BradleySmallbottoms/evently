import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors } from '@/theme/colors';
import { radius, shadow, space } from '@/theme/tokens';

type Props = {
  title: string;
  when: string;
  where: string;
  mode: 'physical' | 'digital';
  onPress: () => void;
  onFavoritePress?: () => void;
  favorited?: boolean;
};

const PLACEHOLDER_IMAGES = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
  'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80',
];

function placeholderFor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash + title.charCodeAt(i)) % 97;
  return PLACEHOLDER_IMAGES[hash % PLACEHOLDER_IMAGES.length]!;
}

export function EventCard({
  title,
  when,
  where,
  mode,
  onPress,
  onFavoritePress,
  favorited,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.card as string,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        boxShadow: shadow.card,
      }}
    >
      <View style={{ height: 180, backgroundColor: colors.accentSoft }}>
        <Image
          source={{ uri: placeholderFor(title) }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={200}
        />
        <Pressable
          accessibilityRole="button"
          onPress={(e) => {
            e.stopPropagation?.();
            onFavoritePress?.();
          }}
          style={{
            position: 'absolute',
            top: space.md,
            right: space.md,
            width: 36,
            height: 36,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(255,255,255,0.92)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SymbolView
            name={(favorited ? 'heart.fill' : 'heart') as never}
            size={18}
            tintColor={favorited ? colors.accent : (colors.ink as string)}
          />
        </Pressable>
        <View
          style={{
            position: 'absolute',
            left: space.md,
            bottom: space.md,
            backgroundColor: colors.accent,
            borderRadius: radius.pill,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
          }}
        >
          <AppText variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
            {mode === 'digital' ? 'Online' : 'Live'}
          </AppText>
        </View>
      </View>
      <View style={{ padding: space.lg, gap: space.xs }}>
        <AppText variant="subtitle" numberOfLines={2}>
          {title}
        </AppText>
        <AppText variant="caption">{when}</AppText>
        <AppText variant="caption" numberOfLines={1}>
          {where}
        </AppText>
      </View>
    </Pressable>
  );
}

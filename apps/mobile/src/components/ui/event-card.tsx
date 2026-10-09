import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

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
  const { t } = useTranslation();

  return (
    <Animated.View
      style={{
        transitionProperty: ['transform', 'opacity'],
        transitionDuration: 120,
        backgroundColor: colors.card as string,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        boxShadow: shadow.card,
      }}
    >
      {/* Favorite sits as a sibling so web does not nest <button> inside <button>. */}
      {onFavoritePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={favorited ? t('events.unfavorite') : t('events.favorite')}
          onPress={onFavoritePress}
          style={{
            position: 'absolute',
            top: space.md,
            right: space.md,
            zIndex: 2,
            width: 40,
            height: 40,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(255,255,255,0.94)',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: shadow.soft,
          }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView
              name={(favorited ? 'heart.fill' : 'heart') as never}
              size={18}
              tintColor={favorited ? colors.accent : (colors.ink as string)}
            />
          ) : (
            <MaterialIcons
              name={favorited ? 'favorite' : 'favorite-border'}
              size={20}
              color={favorited ? colors.accent : (colors.ink as string)}
            />
          )}
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.985 : 1 }],
          opacity: pressed ? 0.96 : 1,
        })}
      >
        <View style={{ height: 210, backgroundColor: colors.accentSoft }}>
          <Image
            source={{ uri: placeholderFor(title) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 88,
              experimental_backgroundImage:
                'linear-gradient(to bottom, rgba(20,20,20,0) 0%, rgba(20,20,20,0.45) 100%)',
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: space.md,
              bottom: space.md,
              backgroundColor: colors.accent,
              borderRadius: radius.pill,
              paddingHorizontal: space.md,
              paddingVertical: space.xs + 1,
              boxShadow: shadow.cta,
            }}
          >
            <AppText variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {mode === 'digital' ? 'Online' : 'Live'}
            </AppText>
          </View>
        </View>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <AppText variant="subtitle" numberOfLines={2} style={{ fontSize: 17, lineHeight: 23 }}>
            {title}
          </AppText>
          <View style={{ gap: space.xs }}>
            <MetaRow sf="calendar" md="event" text={when} />
            <MetaRow sf="mappin.and.ellipse" md="place" text={where} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function MetaRow({
  sf,
  md,
  text,
}: {
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  text: string;
}) {
  const tint = colors.inkFaint as string;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={sf as never} size={14} tintColor={tint} />
      ) : (
        <MaterialIcons name={md} size={16} color={tint} />
      )}
      <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

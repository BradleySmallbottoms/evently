import { deviceAssetUrl } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { API_URL } from '@/lib/api';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

/** Portrait until the file reports its own size. */
const FALLBACK_RATIO = 3 / 4;

type PillProps = {
  label: string;
  size?: 'sm' | 'md';
};

/** Upper-left label on a sponsored image. */
export function SponsoredPill({ label, size = 'md' }: PillProps) {
  const compact = size === 'sm';
  return (
    <View
      pointerEvents="none"
      style={{
        alignSelf: 'flex-start',
        backgroundColor: colors.card,
        borderRadius: radius.pill,
        paddingHorizontal: compact ? space.sm : space.md,
        paddingVertical: compact ? 2 : space.xs,
      }}
    >
      <AppText
        variant="label"
        numberOfLines={1}
        style={{ color: colors.ink, fontSize: compact ? 11 : 13, lineHeight: compact ? 14 : 18 }}
      >
        {label}
      </AppText>
    </View>
  );
}

type Props = {
  /** Used for the button label. The poster itself shows the event. */
  title: string;
  posterUrl: string;
  saved?: boolean;
  onPress: () => void;
  onSavePress?: () => void;
};

function posterUri(posterUrl: string): string {
  if (Platform.OS === 'web') return posterUrl;
  return deviceAssetUrl(posterUrl, API_URL);
}

/** The poster is the whole row. Title, time, and place stay on the image. */
export function SponsoredEventCard({ title, posterUrl, saved, onPress, onSavePress }: Props) {
  const { t } = useTranslation();
  const [ratio, setRatio] = useState(FALLBACK_RATIO);
  const label = t('events.sponsored');
  const uri = posterUri(posterUrl);
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: colors.accentSoft,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${title}`}
        onPress={onPress}
      >
        <Image
          accessible={false}
          accessibilityIgnoresInvertColors
          recyclingKey={uri}
          source={{ uri }}
          contentFit="contain"
          style={{ width: '100%', aspectRatio: ratio }}
          onLoad={(event) => {
            const { width, height } = event.source;
            if (width > 0 && height > 0) setRatio(width / height);
          }}
        />
        <View style={{ position: 'absolute', left: space.md, top: space.md }}>
          <SponsoredPill label={label} />
        </View>
      </Pressable>
      {onSavePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? t('events.unfavorite') : t('events.favorite')}
          onPress={onSavePress}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: space.md,
            right: space.md,
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.card,
            borderRadius: radius.pill,
          }}
        >
          {process.env.EXPO_OS === 'ios' ? (
            <SymbolView
              name={(saved ? 'heart.fill' : 'heart') as never}
              size={18}
              tintColor={saved ? colors.accent : colors.inkMuted}
            />
          ) : (
            <MaterialIcons
              name={saved ? 'favorite' : 'favorite-border'}
              size={20}
              color={saved ? colors.accent : colors.inkMuted}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
